/**
 * Simple AI-Powered Decision Engine for Tambo Voice Agent
 *
 * Uses OpenAI to intelligently decide when to send transcripts to Tambo
 * and summarizes them. No complex hard-coded rules - just smart AI decisions.
 */
const SYSTEM_PROMPT = `You are an AI assistant that decides when to send voice transcripts to a UI generation system called Tambo.

CONTEXT: You're analyzing conversation from a collaborative meeting where multiple people might be:
- Building on each other's ideas
- Editing shared documents/presentations
- Making requests across multiple sentences with pauses
- Referring to previous requests with phrases like "do it", "the task at hand", "that component"
- Searching for or discussing YouTube content

Your job: Analyze the conversation and decide if it contains a complete, actionable request for UI components or functionality.

CRITICAL GUIDELINES:
- ALWAYS look for references to previous requests: "do it", "the task at hand", "that", "use a component for X"
- When someone says "do it" or similar, find the original request in the conversation context
- Items marked [ACTIONABLE REQUEST] are previous UI requests that current text might reference
- Send requests for UI components: timers, sliders, charts, forms, documents, presentations, participant lists, etc.
- Send editing/modification requests: "change the title", "add a chart", "update the data"
- Combine fragmented thoughts across speakers and time
- If the current text refers to a previous request, include the ORIGINAL REQUEST DETAILS in your summary
- Create complete, specific summaries that include what was actually requested (≤60 words)
- Be permissive - when in doubt, send it rather than filter it

YOUTUBE-SPECIFIC GUIDELINES:
- Detect YouTube search requests: "show me latest videos about X", "find newest tutorials", "what's trending"
- Identify quality preferences: "official", "verified", "high quality", "no clickbait"
- Note time preferences: "latest", "today", "this week", "newest"
- Recognize transcript requests: "skip to the part about X", "find where they mention Y"
- When someone asks for YouTube content, enhance the summary with:
  * Time frame (latest = last 7 days)
  * Quality signals (official channels preferred)
  * Content type (tutorial, music, news, etc.)

EXAMPLES:
- Previous: "Can you show me the participants?" Current: "do it with a component" → Summary: "Show the participants using a UI component"
- Previous: "create a timer" Current: "make it 5 minutes" → Summary: "Create a 5-minute timer"
- "Show me the latest React tutorials" → Summary: "Search YouTube for React tutorials from the last 7 days, prioritizing official/verified channels"
- "Find where they talk about hooks in that video" → Summary: "Navigate to transcript sections about React hooks in the current video"

Return JSON:
{
  "should_send": boolean,
  "summary": "complete actionable request with specific details from context", 
  "confidence": number (0-100),
  "reason": "brief explanation"
}`;
export class DecisionEngine {
    constructor(apiKey) {
        this.buffers = new Map();
        this.meetingContext = {
            recentTranscripts: [],
            conversationHistory: [],
            lastDecisionTime: 0,
            pendingCollaborativeRequest: undefined
        };
        // Meeting-optimized configuration
        this.BUFFER_TIMEOUT_MS = 5000; // 5 second pause for meeting discussions
        this.MAX_BUFFER_CHARS = 500; // Longer for collaborative discussions
        this.MEETING_CONTEXT_WINDOW_MS = 30000; // 30 seconds of context
        this.MAX_RECENT_TRANSCRIPTS = 10; // Keep last 10 transcripts for context
        this.apiKey = apiKey;
    }
    /**
     * Process incoming transcript from a participant
     */
    async processTranscript(transcript, participantId = 'unknown') {
        const buffer = this.getOrCreateBuffer(participantId);
        // Add to buffer
        buffer.texts.push(transcript);
        buffer.lastSpoke = Date.now();
        // Track in meeting context
        this.addToMeetingContext(participantId, transcript);
        // Clear existing timer
        if (buffer.timer) {
            clearTimeout(buffer.timer);
        }
        // Set timer to analyze after pause
        buffer.timer = setTimeout(() => {
            this.analyzeAndDecide(participantId);
        }, this.BUFFER_TIMEOUT_MS);
        // Analyze early if buffer gets long
        const combined = buffer.texts.join(' ').trim();
        if (combined.length >= this.MAX_BUFFER_CHARS) {
            await this.analyzeAndDecide(participantId);
        }
    }
    /**
     * Add transcript to meeting context for cross-participant awareness
     */
    addToMeetingContext(participantId, transcript) {
        const now = Date.now();
        // Add to recent transcripts (for immediate context)
        this.meetingContext.recentTranscripts.push({
            participantId,
            text: transcript,
            timestamp: now
        });
        // Add to conversation history (for longer-term context)
        this.meetingContext.conversationHistory.push({
            participantId,
            text: transcript,
            timestamp: now,
            wasActionable: false // Will be updated after decision
        });
        // Clean up old transcripts (keep only recent ones)
        const cutoffTime = now - this.MEETING_CONTEXT_WINDOW_MS;
        this.meetingContext.recentTranscripts = this.meetingContext.recentTranscripts
            .filter(t => t.timestamp > cutoffTime)
            .slice(-this.MAX_RECENT_TRANSCRIPTS);
        // Clean up old conversation history (keep longer window for context)
        const historyCutoffTime = now - (this.MEETING_CONTEXT_WINDOW_MS * 3); // 90 seconds
        this.meetingContext.conversationHistory = this.meetingContext.conversationHistory
            .filter(t => t.timestamp > historyCutoffTime)
            .slice(-20); // Keep last 20 conversation turns
    }
    /**
     * Build meeting context for AI decision
     */
    buildMeetingContext(currentParticipant, currentText) {
        // Always include broader conversation history for better context understanding
        const now = Date.now();
        const lookbackTime = now - (this.MEETING_CONTEXT_WINDOW_MS * 2); // 60 seconds lookback
        // Get relevant conversation history (including actionable requests)
        const conversationContext = this.meetingContext.conversationHistory
            .filter(t => t.timestamp > lookbackTime)
            .slice(-8) // Last 8 conversation turns for context
            .map(t => `${t.participantId}: "${t.text}"${t.wasActionable ? ' [ACTIONABLE REQUEST]' : ''}`)
            .join('\n');
        // Get immediate recent context from other participants  
        const recentContext = this.meetingContext.recentTranscripts
            .filter(t => t.participantId !== currentParticipant)
            .slice(-2) // Last 2 from others
            .map(t => `${t.participantId}: "${t.text}"`)
            .join('\n');
        if (!conversationContext && !recentContext) {
            return currentText;
        }
        const contextualInput = `CONVERSATION CONTEXT:
${conversationContext ? `Previous conversation:
${conversationContext}

` : ''}${recentContext ? `Recent context from others:
${recentContext}

` : ''}Current speaker (${currentParticipant}): "${currentText}"

IMPORTANT: 
- Pay attention to references like "the task at hand", "do it", "that", etc. which refer to previous requests
- If the current text refers to a previous request, include the original request details in your summary
- Look for actionable requests marked with [ACTIONABLE REQUEST] to understand what "it" or "that" refers to

Analyze the current speaker's statement in full conversational context.`;
        console.log(`🔗 [DecisionEngine] Enhanced meeting context:`, {
            conversationContext: !!conversationContext,
            recentContext: !!recentContext,
            currentText,
            contextLength: contextualInput.length
        });
        return contextualInput;
    }
    /**
     * Analyze buffered text and make AI decision with meeting context
     */
    async analyzeAndDecide(participantId) {
        const buffer = this.buffers.get(participantId);
        if (!buffer || buffer.texts.length === 0) {
            return;
        }
        const combined = buffer.texts.join(' ').trim();
        buffer.texts = []; // Clear buffer
        if (!combined) {
            return;
        }
        console.log(`🤖 [DecisionEngine] Analyzing with meeting context: "${combined}"`);
        try {
            // Build contextual input with meeting awareness
            const contextualInput = this.buildMeetingContext(participantId, combined);
            const decision = await this.makeAIDecision(contextualInput);
            console.log(`🎯 [DecisionEngine] Decision:`, {
                should_send: decision.should_send,
                confidence: decision.confidence,
                summary: decision.summary,
                reason: decision.reason,
                hadMeetingContext: contextualInput !== combined
            });
            // Update meeting context if decision was made
            if (decision.should_send) {
                this.meetingContext.lastDecisionTime = Date.now();
                this.meetingContext.pendingCollaborativeRequest = decision.summary;
                // Mark the corresponding conversation history item as actionable
                const recentHistoryItem = this.meetingContext.conversationHistory
                    .filter(h => h.participantId === participantId)
                    .slice(-1)[0]; // Get the most recent item from this participant
                if (recentHistoryItem) {
                    recentHistoryItem.wasActionable = true;
                }
            }
            // Call callback if set
            if (this.decisionCallback) {
                this.decisionCallback(decision, participantId, combined);
            }
        }
        catch (error) {
            console.error('❌ [DecisionEngine] AI decision failed:', error);
            // Simple fallback - send if it contains obvious UI words
            const hasUIWords = /\b(create|show|generate|display|make|timer|slider|chart|button|form|document|presentation|edit|change|update|add)\b/i.test(combined);
            const fallbackDecision = {
                should_send: hasUIWords,
                summary: combined,
                confidence: hasUIWords ? 70 : 20,
                reason: hasUIWords ? 'Contains UI keywords (fallback)' : 'No clear intent (fallback)'
            };
            if (this.decisionCallback) {
                this.decisionCallback(fallbackDecision, participantId, combined);
            }
        }
    }
    /**
     * Let AI make the decision
     */
    async makeAIDecision(transcript) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: transcript }
                ]
            })
        });
        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }
        const data = await response.json();
        const decision = JSON.parse(data.choices[0].message.content);
        // Validate and return
        return {
            should_send: Boolean(decision.should_send),
            summary: String(decision.summary || transcript).trim(),
            confidence: Number(decision.confidence || 50),
            reason: String(decision.reason || 'AI decision')
        };
    }
    /**
     * Get or create buffer for participant
     */
    getOrCreateBuffer(participantId) {
        let buffer = this.buffers.get(participantId);
        if (!buffer) {
            buffer = {
                texts: [],
                lastSpoke: 0,
                participantId
            };
            this.buffers.set(participantId, buffer);
        }
        return buffer;
    }
    /**
     * Set callback for when decisions are made
     */
    onDecision(callback) {
        this.decisionCallback = callback;
    }
    /**
     * Clear all buffers
     */
    clearAllBuffers() {
        for (const buffer of this.buffers.values()) {
            if (buffer.timer) {
                clearTimeout(buffer.timer);
            }
        }
        this.buffers.clear();
    }
}
//# sourceMappingURL=decision-engine.js.map