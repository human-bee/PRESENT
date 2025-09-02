import { Room } from 'livekit-client';
import { Agent as OpenAIAgent, run as runAgent, tool as agentTool } from '@openai/agents';
import z from 'zod';

export function isStartDebate(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return (
    /(^|\b)(start|begin|let's|lets|launch)\b.*\bdebate\b/.test(lower) ||
    /\bdebate\b/.test(lower)
  );
}

function sanitizeIdPart(s: string): string {
  return (s || 'room').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export class DebateJudgeManager {
  private room: Room;
  private roomName: string;
  private messageId: string | null = null;
  private judge: OpenAIAgent | null = null;

  constructor(room: Room, roomName: string) {
    this.room = room;
    this.roomName = roomName || 'room';
  }

  isActive(): boolean {
    return !!this.messageId && !!this.judge;
  }

  getMessageId(): string | null {
    return this.messageId;
  }

  private async publishData(topic: string, payload: unknown): Promise<void> {
    try {
      this.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
        topic,
      });
    } catch (e) {
      console.warn('[DebateJudge] Failed publishData', topic, e);
    }
  }

  private async publishToolCall(tool: string, params: Record<string, unknown>): Promise<void> {
    const event = {
      id: `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      roomId: this.room.name || 'unknown',
      type: 'tool_call' as const,
      payload: {
        tool,
        params,
        context: { source: 'voice-judge', timestamp: Date.now() },
      },
      timestamp: Date.now(),
      source: 'voice' as const,
    };
    await this.publishData('tool_call', event);
  }

  private async publishUiUpdate(patch: Record<string, unknown>): Promise<void> {
    if (!this.messageId) return;
    await this.publishToolCall('ui_update', { messageId: this.messageId, patch });
  }

  private createJudgeAgent(messageId: string): OpenAIAgent {
    const verifyClaim = agentTool({
      name: 'verify_claim',
      description:
        'Verify a factual claim. Return verdict, confidence (0-100), and short rationale.',
      parameters: z.object({
        claim: z.string().describe('The claim to verify'),
        context: z.string().optional().describe('Conversation context'),
      }),
      async execute({ claim, context }: { claim: string; context?: string }) {
        try {
          const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'gpt-5-mini',
              temperature: 0.2,
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a concise fact checker. Output JSON with keys: verdict (Supported|Refuted|Partial|Unverifiable), confidence (0-100), rationale (<=25 words).',
                },
                { role: 'user', content: `Claim: ${claim}\nContext: ${context || ''}` },
              ],
            }),
          });
          const data = (await resp.json()) as any;
          const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
          return parsed;
        } catch (e) {
          return { verdict: 'Unverifiable', confidence: 0, rationale: 'Verification failed' };
        }
      },
    });

    const scoreUpdate = agentTool({
      name: 'score_update',
      description:
        'Update the debate scorecard metrics and timeline. Include optional latest factCheck.',
      parameters: z.object({
        p1Delta: z.record(z.any()).optional().describe('Partial scores for participant 1'),
        p2Delta: z.record(z.any()).optional().describe('Partial scores for participant 2'),
        liveClaim: z.string().optional(),
        factCheck: z.record(z.any()).optional().describe('Fact check entry'),
        timelineText: z.string().optional().describe('Short timeline entry'),
      }),
      async execute({ p1Delta, p2Delta, liveClaim, factCheck, timelineText }: any) {
        const patch: Record<string, unknown> = {};
        if (p1Delta) patch.p1 = p1Delta;
        if (p2Delta) patch.p2 = p2Delta;
        if (typeof liveClaim === 'string') patch.liveClaim = liveClaim;
        if (factCheck) patch.factChecks = [factCheck];
        if (timelineText) patch.timeline = [{ timestamp: Date.now(), text: timelineText }];
        await (async () => {
          const event = {
            id: `uiupdate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            roomId: (this.room.name || 'unknown'),
            type: 'tool_call' as const,
            payload: {
              tool: 'ui_update',
              params: { messageId, patch },
              context: { source: 'voice-judge', timestamp: Date.now() },
            },
            timestamp: Date.now(),
            source: 'voice' as const,
          };
          await this.publishData('tool_call', event);
        })();
        return { ok: true };
      },
    });

    const deepResearch = agentTool({
      name: 'deep_research',
      description: 'Trigger deeper MCP research (e.g., Exa) for a claim or topic.',
      parameters: z.object({
        query: z.string().describe('Research query'),
        maxResults: z.number().optional().describe('Max results to fetch'),
      }),
      async execute({ query, maxResults }: { query: string; maxResults?: number }) {
        // Dispatch a generic MCP call; ToolDispatcher handles mcp_* via window bridge
        const event = {
          id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roomId: (this.room.name || 'unknown'),
          type: 'tool_call' as const,
          payload: {
            tool: 'mcp_exa',
            params: { query, maxResults: maxResults ?? 5 },
            context: { source: 'voice-judge', timestamp: Date.now() },
          },
          timestamp: Date.now(),
          source: 'voice' as const,
        };
        await this.publishData('tool_call', event);
        // Add a timeline note for visibility
        await this.publishUiUpdate({
          timeline: [{ timestamp: Date.now(), text: `🔎 Deep research requested: ${query}` }],
        });
        return { ok: true };
      },
    });

    return new OpenAIAgent({
      name: 'DebateJudge',
      model: 'gpt-5-mini',
      instructions:
        'Monitor debate claims. For significant claims, call verify_claim. If confidence >= 60, call score_update with modest adjustments. Favor lowering bsMeter on Refuted, raising on Supported. Keep updates brief and frequent. When uncertain or complex, call deep_research(query).',
      tools: [verifyClaim, scoreUpdate, deepResearch],
    });
  }

  async ensureScorecard(participant1: string, participant2: string, topic = 'Open debate') {
    if (this.messageId) return this.messageId;
    const msgId = `debate-${sanitizeIdPart(this.roomName)}`;
    this.messageId = msgId;
    this.judge = this.createJudgeAgent(msgId);

    const params = {
      componentType: 'DebateScorecard',
      messageId: msgId,
      participant1: { name: participant1 || 'Debater A', color: '#3B82F6' },
      participant2: { name: participant2 || 'Debater B', color: '#EF4444' },
      topic,
      rounds: 5,
      visualStyle: 'boxing',
    };
    await this.publishToolCall('generate_ui_component', params);
    return msgId;
  }

  async processClaim(speakerId: string, claim: string): Promise<void> {
    if (!this.messageId || !this.judge) return;
    const trimmed = (claim || '').trim();
    if (!trimmed) return;
    // Minimal length gate to avoid noise
    if (trimmed.split(/\s+/).length < 6) return;

    try {
      await runAgent(this.judge, `Claim by ${speakerId}: ${trimmed}`);
      // add liveClaim & timeline entry for UI feedback
      await this.publishUiUpdate({
        liveClaim: trimmed,
        timeline: [{ timestamp: Date.now(), text: `${speakerId}: ${trimmed}` }],
      });
    } catch (e) {
      console.warn('[DebateJudge] processClaim failed', e);
    }
  }
}
