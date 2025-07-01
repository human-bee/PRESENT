/**
 * Simple AI-Powered Decision Engine for Tambo Voice Agent
 *
 * AGENT #2 of 3 in the Tambo Architecture
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
 */
export interface Decision {
    should_send: boolean;
    summary: string;
    confidence: number;
    reason?: string;
    intent?: 'youtube_search' | 'ui_component' | 'general';
    structuredContext?: {
        rawQuery?: string;
        wantsLatest?: boolean;
        wantsOfficial?: boolean;
        contentType?: string;
        artist?: string;
    };
}
export interface ConversationBuffer {
    texts: string[];
    lastSpoke: number;
    timer?: NodeJS.Timeout;
    participantId: string;
}
export interface MeetingContext {
    recentTranscripts: Array<{
        participantId: string;
        text: string;
        timestamp: number;
    }>;
    conversationHistory: Array<{
        participantId: string;
        text: string;
        timestamp: number;
        wasActionable: boolean;
    }>;
    lastDecisionTime: number;
    pendingCollaborativeRequest?: string;
}
export interface DecisionEngineConfig {
    intents?: Record<string, string[]>;
    keywords?: Record<string, string[]>;
}
export declare class DecisionEngine {
    private apiKey;
    private config;
    private buffers;
    private meetingContext;
    private decisionCallback?;
    private readonly BUFFER_TIMEOUT_MS;
    private readonly MAX_BUFFER_CHARS;
    private readonly MEETING_CONTEXT_WINDOW_MS;
    private readonly MAX_RECENT_TRANSCRIPTS;
    constructor(apiKey: string, config?: DecisionEngineConfig);
    /**
     * Process incoming transcript from a participant
     */
    processTranscript(transcript: string, participantId?: string): Promise<void>;
    /**
     * Add transcript to meeting context for cross-participant awareness
     */
    private addToMeetingContext;
    /**
     * Build meeting context for AI decision
     */
    private buildMeetingContext;
    /**
     * Analyze buffered text and make AI decision with meeting context
     */
    private analyzeAndDecide;
    /**
     * Detect intent and extract structured context from transcript
     */
    private detectIntent;
    /**
     * Let AI make the decision
     */
    private makeAIDecision;
    /**
     * Get or create buffer for participant
     */
    private getOrCreateBuffer;
    /**
     * Set callback for when decisions are made
     */
    onDecision(callback: (decision: Decision, participantId: string, originalText: string) => void): void;
    /**
     * Clear all buffers
     */
    clearAllBuffers(): void;
}
//# sourceMappingURL=decision-engine.d.ts.map