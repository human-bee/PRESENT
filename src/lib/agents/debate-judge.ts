// Narrow Room type to a minimal interface to support rtc-node Room
interface RoomLike {
  name?: string;
  localParticipant?: {
    publishData: (
      data: Uint8Array,
      options?: { reliable?: boolean; topic?: string },
    ) => unknown;
  } | null;
}
import { Agent as OpenAIAgent, run as runAgent, tool as agentTool } from '@openai/agents';
import z from 'zod';

export function isStartDebate(text: string): boolean {
  const lower = (text || '').toLowerCase();
  // Only treat as a start request when an explicit start/creation verb is present.
  if (!/\bdebate\b/.test(lower)) return false;
  return (
    /(^|\b)(start|begin|launch|create|open|setup|set\s*up|initiate|kick\s*off)\b.*\bdebate\b/.test(
      lower,
    ) ||
    /\bnew\b.*\bdebate\b/.test(lower) ||
    /\bdebate\b.*\b(start|begin|launch|create|open|setup|set\s*up|initiate|kick\s*off)\b/.test(
      lower,
    )
  );
}

function sanitizeIdPart(s: string): string {
  return (s || 'room').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export class DebateJudgeManager {
  private room: RoomLike;
  private roomName: string;
  private messageId: string | null = null;
  private judge: OpenAIAgent | null = null;

  constructor(room: RoomLike, roomName: string) {
    this.room = room;
    this.roomName = roomName || 'room';
  }

  isActive(): boolean {
    return !!this.messageId && !!this.judge;
  }

  getMessageId(): string | null {
    return this.messageId;
  }

  /**
   * Activate the judge for an existing scorecard that was created by another path
   * (e.g., LLM tool call). This avoids dispatching a second UI creation event.
   */
  async activateWithMessageId(messageId: string): Promise<string> {
    if (!messageId) return this.messageId || '';
    if (!this.messageId) {
      this.messageId = messageId;
      this.judge = this.createJudgeAgent(messageId);
    }
    return this.messageId!;
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

  // Force a verification cycle regardless of the agent's tool choice
  private async verifyClaimDirect(claim: string, context?: string | null): Promise<void> {
    const manager = this;
    const debugMeta = { model: 'gpt-5-mini', tool: 'verify_claim', claim, context: context || '' };
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
      const reqId = resp.headers.get('x-request-id') || resp.headers.get('x-openai-request-id');
      console.log('[DebateJudge.verify_claim] request', { ...debugMeta, requestId: reqId });
      const data = (await resp.json()) as any;
      let content = String(data.choices?.[0]?.message?.content || '{}');
      const fenced = content.match(/```(?:json)?\n([\s\S]*?)\n```/i);
      if (fenced && fenced[1]) content = fenced[1];
      const parsed = JSON.parse(content || '{}');
      console.log('[DebateJudge.verify_claim] response', { requestId: reqId, parsed });

      const verdict: 'Supported' | 'Refuted' | 'Partial' | 'Unverifiable' =
        parsed?.verdict || 'Unverifiable';
      const confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 0;
      const rationale = typeof parsed?.rationale === 'string' ? parsed.rationale : '';

      // Auto-score delta for visibility
      const p1Delta: Record<string, number> = {};
      if (verdict === 'Supported') {
        p1Delta.factualAccuracy = 20;
        p1Delta.bsMeter = -10;
      } else if (verdict === 'Refuted') {
        p1Delta.factualAccuracy = -20;
        p1Delta.bsMeter = 20;
      } else if (verdict === 'Partial') {
        p1Delta.factualAccuracy = 10;
        p1Delta.bsMeter = -5;
      }

      await manager.publishUiUpdate({
        liveClaim: claim,
        factChecks: [
          {
            claim,
            verdict,
            confidence,
            contextNotes: rationale ? [rationale] : [],
            timestamp: Date.now(),
          },
        ],
        timeline: [
          {
            timestamp: Date.now(),
            text: `Fact check: ${verdict}${confidence ? ` (${confidence}%)` : ''}`,
            type: 'fact_check',
          },
        ],
        p1Delta: Object.keys(p1Delta).length ? p1Delta : undefined,
      } as any);
    } catch (e) {
      console.warn('[DebateJudge.verify_claim] error (direct)', e);
    }
  }

  private createJudgeAgent(messageId: string): OpenAIAgent {
    const manager = this;
    const verifyClaim = agentTool({
      name: 'verify_claim',
      description:
        'Verify a factual claim. Return verdict, confidence (0-100), and short rationale.',
      parameters: z.object({
        claim: z.string().describe('The claim to verify'),
        context: z.string().nullable().describe('Conversation context'),
      }),
      async execute({ claim, context }: { claim: string; context?: string | null }) {
        const debugMeta = { model: 'gpt-5-mini', tool: 'verify_claim', claim, context };
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
          const reqId = resp.headers.get('x-request-id') || resp.headers.get('x-openai-request-id');
          console.log('[DebateJudge.verify_claim] request', { ...debugMeta, requestId: reqId });
          const data = (await resp.json()) as any;
          let content = String(data.choices?.[0]?.message?.content || '{}');
          const fenced = content.match(/```(?:json)?\n([\s\S]*?)\n```/i);
          if (fenced && fenced[1]) content = fenced[1];
          const parsed = JSON.parse(content || '{}');
          console.log('[DebateJudge.verify_claim] response', { requestId: reqId, parsed });

          // Proactively update the UI, even if the agent doesn't call score_update
          const verdict: 'Supported' | 'Refuted' | 'Partial' | 'Unverifiable' =
            parsed?.verdict || 'Unverifiable';
          const confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 0;
          const rationale = typeof parsed?.rationale === 'string' ? parsed.rationale : '';

          try {
            // Simple auto-scoring heuristics to make changes visible immediately
            const p1Delta: Record<string, number> = {};
            if (verdict === 'Supported') {
              p1Delta.factualAccuracy = 20;
              p1Delta.bsMeter = -10;
            } else if (verdict === 'Refuted') {
              p1Delta.factualAccuracy = -20;
              p1Delta.bsMeter = 20;
            } else if (verdict === 'Partial') {
              p1Delta.factualAccuracy = 10;
              p1Delta.bsMeter = -5;
            }
            await manager.publishUiUpdate({
              liveClaim: claim,
              factChecks: [
                {
                  claim,
                  verdict,
                  confidence,
                  contextNotes: rationale ? [rationale] : [],
                  sourcesText: parsed?.source || parsed?.sourceText || undefined,
                  timestamp: Date.now(),
                },
              ],
              timeline: [
                {
                  timestamp: Date.now(),
                  text: `Fact check: ${verdict}${confidence ? ` (${confidence}%)` : ''}`,
                  type: 'fact_check',
                },
              ],
              p1Delta: Object.keys(p1Delta).length ? p1Delta : undefined,
            } as any);
          } catch (e) {
            console.warn('[DebateJudge] failed to publish UI update from verify_claim', e);
          }
          return parsed;
        } catch (e) {
          console.warn('[DebateJudge.verify_claim] error', e);
          return { verdict: 'Unverifiable', confidence: 0, rationale: 'Verification failed' };
        }
      },
    });

    const scoreUpdate = agentTool({
      name: 'score_update',
      description:
        'Update the debate scorecard metrics and timeline. Include optional latest factCheck.',
      parameters: z.object({
        p1Delta: z
          .record(z.number())
          .nullable()
          .optional()
          .describe('Partial numeric scores for participant 1'),
        p2Delta: z
          .record(z.number())
          .nullable()
          .optional()
          .describe('Partial numeric scores for participant 2'),
        liveClaim: z.string().nullable().optional(),
        factCheck: z
          .object({
            claim: z.string().nullable().optional(),
            verdict: z.enum(['Supported', 'Refuted', 'Partial', 'Unverifiable']),
            confidence: z.number().min(0).max(100),
            // Flatten sources to a simple, schema-safe text field to avoid URL validation issues
            sourcesText: z.string().nullable().optional(),
            contextNotes: z.array(z.string()).nullable().optional(),
            timestamp: z.number().nullable().optional(),
          })
          .nullable()
          .optional()
          .describe('Fact check summary entry'),
        timelineText: z.string().nullable().optional().describe('Short timeline entry'),
      }),
      async execute({ p1Delta, p2Delta, liveClaim, factCheck, timelineText }: any) {
        const patch: Record<string, unknown> = {};
        if (p1Delta) patch.p1 = p1Delta;
        if (p2Delta) patch.p2 = p2Delta;
        if (typeof liveClaim === 'string') patch.liveClaim = liveClaim;
        if (factCheck) {
          const fc = {
            timestamp: Date.now(),
            ...factCheck,
          };
          patch.factChecks = [fc];
        }
        if (timelineText) patch.timeline = [{ timestamp: Date.now(), text: timelineText }];
        await (async () => {
          const event = {
            id: `uiupdate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            roomId: (manager.room?.name || 'unknown'),
            type: 'tool_call' as const,
            payload: {
              tool: 'ui_update',
              params: { messageId, patch },
              context: { source: 'voice-judge', timestamp: Date.now() },
            },
            timestamp: Date.now(),
            source: 'voice' as const,
          };
          await manager.publishData('tool_call', event);
        })();
        return { ok: true };
      },
    });

    const deepResearch = agentTool({
      name: 'deep_research',
      description: 'Trigger deeper MCP research (e.g., Exa) for a claim or topic.',
      parameters: z.object({
        query: z.string().describe('Research query'),
        maxResults: z.number().nullable().optional().describe('Max results to fetch'),
      }),
      async execute({ query, maxResults }: { query: string; maxResults?: number | null }) {
        // Dispatch a generic MCP call; ToolDispatcher handles mcp_* via window bridge
        const event = {
          id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roomId: (manager.room?.name || 'unknown'),
          type: 'tool_call' as const,
          payload: {
            tool: 'mcp_exa',
            params: { query, maxResults: maxResults ?? 5 },
            context: { source: 'voice-judge', timestamp: Date.now() },
          },
          timestamp: Date.now(),
          source: 'voice' as const,
        };
        await manager.publishData('tool_call', event);
        // Add a timeline note for visibility
        await manager.publishUiUpdate({
          timeline: [{ timestamp: Date.now(), text: `🔎 Deep research requested: ${query}` }],
        });
        // Also emit a synthetic neutral fact check immediately so UI shows content even if MCP is stubbed
        await manager.publishUiUpdate({
          factChecks: [
            {
              claim: query,
              verdict: 'Unverifiable',
              confidence: 0,
              contextNotes: ['Research in progress...'],
              timestamp: Date.now(),
            },
          ],
        } as any);
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
    // Allow short fact-y answers (numbers, named entities); skip only single-character fillers
    const wordCount = trimmed.split(/\s+/).length;
    const hasDigits = /\d/.test(trimmed);
    if (wordCount < 2 && !hasDigits) {
      return;
    }

    try {
      await Promise.all([
        runAgent(this.judge, `Claim by ${speakerId}: ${trimmed}`),
        (async () =>
          this.publishUiUpdate({
            liveClaim: trimmed,
            timeline: [{ timestamp: Date.now(), text: `${speakerId}: ${trimmed}` }],
          }))(),
        // Force a verification pass for immediate scoring/feedback
        this.verifyClaimDirect(trimmed, 'Inline verify from processClaim'),
      ]);
    } catch (e) {
      console.warn('[DebateJudge] processClaim failed', e);
    }
  }
}
