/**
 * Simple AI-Powered Decision Engine for custom Voice Agent
 *
 * AGENT #2 of 3 in the custom Architecture
 * =======================================
 * This is the DECISION ENGINE that runs embedded within the Voice Agent.
 *
 * Responsibilities:
 * - Analyze transcriptions to detect actionable requests
 * - Maintain conversation context across multiple speakers
 * - Handle meeting scenarios with collaborative requests
 * - Use GPT-4 to intelligently summarize and filter
 * - Extract intent (YouTube search, UI component, general)
 *
 * Data Flow:
 * 1. Receives transcriptions from Voice Agent
 * 2. Analyzes with 30-second context window
 * 3. Makes AI decision on whether to forward
 * 4. Returns decision with summary & confidence
 * 5. Voice Agent acts on positive decisions
 *
 * Key Features:
 * - Handles "do it" references to previous requests
 * - Detects fragmented requests across speakers
 * - Dynamic configuration from SystemRegistry
 *
 * See docs/THREE_AGENT_ARCHITECTURE.md for complete details.
 *
 * TODO Modularization Map (Wave 2)
 * - Input normalization, transcript window shaping → `core/normalize.ts` with typed helpers.
 * - Rule evaluation (intent detection, heuristics, guardrails) → `core/rules.ts` returning typed results.
 * - Scoring aggregation, weighting, confidence blending → `core/scoring.ts`.
 * - Plan/decision selection and tool call composition → `core/plan.ts`.
 * - Shared domain types (DecisionInput, RuleResult, Score, Plan) → `core/types.ts`.
 * - Facade `decide()` orchestrating normalize → rules → scoring → plan → `index.ts`.
 * - Adapter layers for LiveKit/TLDraw/system integrations kept in `adapters/` with side effects.
 * - Unit tests per pure module (`__tests__/rules.test.ts`, etc.) to lock existing behavior.
 */
import { getPrompt } from './prompt-loader';
import { choosePlan, computeScore, detectIntent as coreDetectIntent, evaluateRules, normalizeTranscript, } from './decision-engine/index';
// Build dynamic system prompt based on available capabilities
const buildSystemPrompt = (config) => {
    const basePrompt = `You are the Decision Engine (Agent #2) in custom's 3-agent architecture.

ARCHITECTURE AWARENESS:
- Voice Agent (Agent #1): Captures and transcribes speech, forwards to you
- YOU (Decision Engine #2): Filter transcriptions for actionable requests
- Tool Dispatcher (Agent #3): Executes tools in the browser

You decide when to send voice transcripts to the UI generation system.

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

`;
    // Add dynamic intents if available
    let dynamicSection = '';
    if (config.intents && Object.keys(config.intents).length > 0) {
        dynamicSection += '\n\nAVAILABLE INTENTS:\n';
        Object.entries(config.intents).forEach(([tool, intents]) => {
            dynamicSection += `- ${tool}: ${intents.join(', ')}\n`;
        });
    }
    if (config.keywords && Object.keys(config.keywords).length > 0) {
        dynamicSection += '\n\nTRIGGER KEYWORDS:\n';
        Object.entries(config.keywords).forEach(([tool, keywords]) => {
            dynamicSection += `- ${tool}: ${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? '...' : ''}\n`;
        });
    }
    const endPrompt = `
Return JSON:
{
  "should_send": boolean,
  "summary": "complete actionable request with specific details from context", 
  "confidence": number (0-100),
  "reason": "brief explanation"
}`;
    return basePrompt + dynamicSection + endPrompt;
};
export class DecisionEngine {
    constructor(apiKey, config = {}) {
        this.buffers = new Map();
        this.meetingContext = {
            recentTranscripts: [],
            conversationHistory: [],
            lastDecisionTime: 0,
            pendingCollaborativeRequest: undefined,
        };
        // Meeting-optimized configuration
        this.BUFFER_TIMEOUT_MS = 5000; // 5 second pause for meeting discussions
        this.MAX_BUFFER_CHARS = 500; // Longer for collaborative discussions
        this.MEETING_CONTEXT_WINDOW_MS = 30000; // 30 seconds of context
        this.MAX_RECENT_TRANSCRIPTS = 10; // Keep last 10 transcripts for context
        this.apiKey = apiKey;
        this.config = config;
    }
    runPipeline(transcript) {
        const normalized = normalizeTranscript(transcript);
        const intent = coreDetectIntent(normalized, this.config);
        const evaluation = evaluateRules(normalized);
        const score = computeScore(evaluation);
        const plan = choosePlan(normalized, intent, evaluation, score);
        return { normalized, intent, evaluation, score, plan };
    }
    planToDecision(plan) {
        return {
            should_send: plan.shouldSend,
            summary: plan.summary,
            confidence: plan.confidence,
            reason: plan.reason,
            intent: plan.intent,
            structuredContext: plan.structuredContext,
        };
    }
    pipeline(transcript) {
        return this.runPipeline(transcript);
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
            timestamp: now,
        });
        // Add to conversation history (for longer-term context)
        this.meetingContext.conversationHistory.push({
            participantId,
            text: transcript,
            timestamp: now,
            wasActionable: false, // Will be updated after decision
        });
        // Clean up old transcripts (keep only recent ones)
        const cutoffTime = now - this.MEETING_CONTEXT_WINDOW_MS;
        this.meetingContext.recentTranscripts = this.meetingContext.recentTranscripts
            .filter((t) => t.timestamp > cutoffTime)
            .slice(-this.MAX_RECENT_TRANSCRIPTS);
        // Clean up old conversation history (keep longer window for context)
        const historyCutoffTime = now - this.MEETING_CONTEXT_WINDOW_MS * 3; // 90 seconds
        this.meetingContext.conversationHistory = this.meetingContext.conversationHistory
            .filter((t) => t.timestamp > historyCutoffTime)
            .slice(-20); // Keep last 20 conversation turns
    }
    /**
     * Build meeting context for AI decision
     */
    buildMeetingContext(currentParticipant, currentText) {
        // Always include broader conversation history for better context understanding
        const now = Date.now();
        const lookbackTime = now - this.MEETING_CONTEXT_WINDOW_MS * 2; // 60 seconds lookback
        // Get relevant conversation history (including actionable requests)
        const conversationContext = this.meetingContext.conversationHistory
            .filter((t) => t.timestamp > lookbackTime)
            .slice(-8) // Last 8 conversation turns for context
            .map((t) => `${t.participantId}: "${t.text}"${t.wasActionable ? ' [ACTIONABLE REQUEST]' : ''}`)
            .join('\n');
        // Get immediate recent context from other participants
        const recentContext = this.meetingContext.recentTranscripts
            .filter((t) => t.participantId !== currentParticipant)
            .slice(-2) // Last 2 from others
            .map((t) => `${t.participantId}: "${t.text}"`)
            .join('\n');
        if (!conversationContext && !recentContext) {
            return currentText;
        }
        const contextualInput = `CONVERSATION CONTEXT:
${conversationContext
            ? `Previous conversation:
${conversationContext}

`
            : ''}${recentContext
            ? `Recent context from others:
${recentContext}

`
            : ''}Current speaker (${currentParticipant}): "${currentText}"

IMPORTANT: 
- Pay attention to references like "the task at hand", "do it", "that", etc. which refer to previous requests
- If the current text refers to a previous request, include the original request details in your summary
- Look for actionable requests marked with [ACTIONABLE REQUEST] to understand what "it" or "that" refers to

Analyze the current speaker's statement in full conversational context.`;
        console.log(`🔗 [DecisionEngine] Context: ${contextualInput.length} chars`);
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
            console.log(`🎯 [DecisionEngine] ${decision.should_send ? '✅ SEND' : '❌ SKIP'} (${decision.confidence}%): ${decision.reason}`);
            // Update meeting context if decision was made
            if (decision.should_send) {
                this.meetingContext.lastDecisionTime = Date.now();
                this.meetingContext.pendingCollaborativeRequest = decision.summary;
                // Mark the corresponding conversation history item as actionable
                const recentHistoryItem = this.meetingContext.conversationHistory
                    .filter((h) => h.participantId === participantId)
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
            const pipelineFallback = this.runPipeline(combined);
            const heuristicDecision = this.planToDecision(pipelineFallback.plan);
            const fallbackDecision = {
                ...heuristicDecision,
                should_send: hasUIWords ? true : heuristicDecision.should_send,
                summary: heuristicDecision.summary || combined,
                confidence: hasUIWords ? Math.max(heuristicDecision.confidence, 70) : 20,
                reason: hasUIWords
                    ? 'Contains UI keywords (fallback)'
                    : heuristicDecision.reason || 'No clear intent (fallback)',
            };
            if (this.decisionCallback) {
                this.decisionCallback(fallbackDecision, participantId, combined);
            }
        }
    }
    /**
     * Enhanced decision analysis that supports parallel tool calls
     */
    async analyzeTranscriptEnhanced(transcript) {
        try {
            // Fast local heuristics for common canvas actions to reduce latency
            const lower = transcript.toLowerCase();
            // Draw smiley face
            if (/\bsmiley\b|\bsmiling face\b/.test(lower) && /\bdraw\b|\bmake\b|\bcreate\b/.test(lower)) {
                const sizeMatch = lower.match(/(\d{2,4})\s*(px|pixels)?/);
                const size = sizeMatch ? Math.max(64, Math.min(1024, Number(sizeMatch[1]) || 300)) : 300;
                return {
                    hasActionableRequest: true,
                    intent: 'ui_generation',
                    toolCalls: [{ tool: 'canvas_draw_smiley', params: { size }, priority: 1 }],
                    reasoning: 'Detected request to draw a smiley face',
                    confidence: 0.9,
                };
            }
            // Create rectangle / ellipse
            if (/\brectangle\b/.test(lower) && /\bdraw\b|\bmake\b|\bcreate\b/.test(lower)) {
                return {
                    hasActionableRequest: true,
                    intent: 'ui_generation',
                    toolCalls: [{ tool: 'canvas_create_rectangle', params: {}, priority: 2 }],
                    reasoning: 'Detected request to draw a rectangle',
                    confidence: 0.75,
                };
            }
            if (/\bellipse\b|\bcircle\b/.test(lower) && /\bdraw\b|\bmake\b|\bcreate\b/.test(lower)) {
                return {
                    hasActionableRequest: true,
                    intent: 'ui_generation',
                    toolCalls: [{ tool: 'canvas_create_ellipse', params: {}, priority: 2 }],
                    reasoning: 'Detected request to draw an ellipse/circle',
                    confidence: 0.75,
                };
            }
            // Create note
            if (/\b(add|create|make)\b.*\bnote\b/.test(lower)) {
                // Try to extract note text after 'that says' or within quotes
                let text = 'Note';
                const saysMatch = transcript.match(/that\s+says\s+"([^"]+)"/i) ||
                    transcript.match(/that\s+says\s+'([^']+)'/i);
                const quoted = transcript.match(/"([^"]+)"/) || transcript.match(/'([^']+)'/);
                if (saysMatch && saysMatch[1])
                    text = saysMatch[1];
                else if (quoted && quoted[1])
                    text = quoted[1];
                return {
                    hasActionableRequest: true,
                    intent: 'ui_generation',
                    toolCalls: [{ tool: 'canvas_create_note', params: { text }, priority: 2 }],
                    reasoning: 'Detected request to add a note',
                    confidence: 0.7,
                };
            }
            const template = await getPrompt('enhancedDecisionTemplate');
            const prompt = template.replace('%TRANSCRIPT%', transcript.replace(/"/g, '"'));
            const requestBody = {
                model: 'gpt-4o-mini',
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }],
            };
            console.log('🔍 [DecisionEngine] Enhanced analysis:', transcript.substring(0, 50) + '...');
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ [DecisionEngine] OpenAI API error details:', {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorText,
                });
                throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
            }
            const data = (await response.json());
            let content = data.choices[0].message.content || '{}';
            // Guard: some models may return fenced JSON despite response_format
            const fenced = content.match(/```(?:json)?\n([\s\S]*?)\n```/i);
            if (fenced && fenced[1]) {
                content = fenced[1];
            }
            let result;
            try {
                result = JSON.parse(content);
            }
            catch (parseError) {
                console.error('❌ [DecisionEngine] Failed to parse OpenAI response:', parseError);
                console.error('❌ [DecisionEngine] Raw content:', content);
                // Fallback: try to extract meaningful info from the response
                const hasActionable = /participant.*tile|show.*tile|display.*tile|create.*component|generate.*component/i.test(transcript);
                return {
                    hasActionableRequest: hasActionable,
                    intent: hasActionable ? 'create_component' : 'general_conversation',
                    toolCalls: hasActionable
                        ? [
                            {
                                tool: 'create_component',
                                params: {
                                    type: 'LivekitParticipantTile',
                                    request: transcript,
                                },
                                priority: 1,
                            },
                        ]
                        : [],
                    reasoning: 'Fallback analysis due to JSON parsing error',
                    confidence: hasActionable ? 75 : 25,
                };
            }
            // Validate and enhance the result
            return {
                hasActionableRequest: result.hasActionableRequest || false,
                intent: result.intent || 'general_conversation',
                toolCalls: result.toolCalls || [],
                reasoning: result.reasoning || 'No reasoning provided',
                confidence: result.confidence || 0.5,
            };
        }
        catch (error) {
            console.error('❌ [DecisionEngine] Error analyzing transcript:', error);
            // Improved fallback for participant tile requests
            const lowerTranscript = transcript.toLowerCase();
            const isParticipantTileRequest = lowerTranscript.includes('participant') && lowerTranscript.includes('tile');
            const isComponentRequest = /\b(show|display|create|generate)\b.*\b(component|tile|timer|weather|chart)\b/i.test(transcript);
            if (isParticipantTileRequest || isComponentRequest) {
                return {
                    hasActionableRequest: true,
                    intent: 'create_component',
                    toolCalls: [
                        {
                            tool: 'create_component',
                            params: {
                                type: isParticipantTileRequest ? 'LivekitParticipantTile' : 'unknown',
                                request: transcript,
                            },
                            priority: 1,
                        },
                    ],
                    reasoning: 'Fallback analysis detected component request',
                    confidence: 70,
                };
            }
            return {
                hasActionableRequest: false,
                intent: 'general_conversation',
                toolCalls: [],
                reasoning: 'Error occurred during analysis',
                confidence: 0.0,
            };
        }
    }
    /**
     * Detect intent and extract structured context from transcript
     */
    async makeAIDecision(transcript) {
        const pipeline = this.runPipeline(transcript);
        const planDecision = this.planToDecision(pipeline.plan);
        // For single-word utterances, be more conservative unless explicit action keywords exist.
        if (pipeline.evaluation.isSingleWord &&
            !['search', 'find', 'play', 'show'].some((keyword) => pipeline.normalized.lower.includes(keyword))) {
            return {
                ...planDecision,
                summary: planDecision.summary || pipeline.normalized.trimmed || transcript,
                intent: pipeline.intent.intent,
                structuredContext: pipeline.intent.structuredContext,
            };
        }
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.1,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: buildSystemPrompt(this.config) },
                        { role: 'user', content: transcript },
                    ],
                }),
            });
            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status}`);
            }
            const data = (await response.json());
            let content = data.choices[0].message.content || '{}';
            const fenced = content.match(/```(?:json)?\n([\s\S]*?)\n```/i);
            if (fenced && fenced[1]) {
                content = fenced[1];
            }
            let parsed;
            try {
                parsed = JSON.parse(content);
            }
            catch (parseError) {
                throw new Error(`OpenAI response parse failure: ${String(parseError)}`);
            }
            return {
                should_send: typeof parsed.should_send === 'boolean'
                    ? parsed.should_send
                    : planDecision.should_send,
                summary: String(parsed.summary || planDecision.summary || transcript).trim(),
                confidence: typeof parsed.confidence === 'number'
                    ? Number(parsed.confidence)
                    : planDecision.confidence,
                reason: String(parsed.reason || planDecision.reason || 'AI decision'),
                intent: pipeline.intent.intent,
                structuredContext: pipeline.intent.structuredContext,
            };
        }
        catch (error) {
            console.error('❌ [DecisionEngine] AI decision failed:', error);
            const hasUIWords = /\b(create|show|generate|display|make|timer|slider|chart|button|form|document|presentation|edit|change|update|add)\b/i.test(transcript);
            const fallbackDecision = {
                ...planDecision,
                should_send: hasUIWords ? true : planDecision.should_send,
                summary: planDecision.summary || transcript,
                confidence: hasUIWords ? Math.max(planDecision.confidence, 70) : 20,
                reason: hasUIWords
                    ? 'Contains UI keywords (fallback)'
                    : planDecision.reason || 'No clear intent (fallback)',
                intent: pipeline.intent.intent,
                structuredContext: pipeline.intent.structuredContext,
            };
            return fallbackDecision;
        }
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
                participantId,
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