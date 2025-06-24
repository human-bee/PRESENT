/**
 * Simple AI-Powered Decision Engine for Tambo Voice Agent
 *
 * Uses OpenAI to intelligently decide when to send transcripts to Tambo
 * and summarizes them. No complex hard-coded rules - just smart AI decisions.
 */
export interface Decision {
    should_send: boolean;
    summary: string;
    confidence: number;
    reason?: string;
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
export declare class DecisionEngine {
    private apiKey;
    private buffers;
    private meetingContext;
    private decisionCallback?;
    private readonly BUFFER_TIMEOUT_MS;
    private readonly MAX_BUFFER_CHARS;
    private readonly MEETING_CONTEXT_WINDOW_MS;
    private readonly MAX_RECENT_TRANSCRIPTS;
    constructor(apiKey: string);
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