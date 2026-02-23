import {
  parseDecisionMessage,
  parseStewardTriggerMessage,
  parseToolCallMessage,
  ToolResultMessageSchema,
} from '@/lib/livekit/protocol';

describe('livekit protocol', () => {
  it('parses tool_call messages', () => {
    const parsed = parseToolCallMessage({
      type: 'tool_call',
      id: 'call-1',
      payload: {
        tool: 'create_component',
        params: { type: 'Timer' },
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.payload.tool).toBe('create_component');
  });

  it('preserves optional experiment metadata in tool_call context', () => {
    const parsed = parseToolCallMessage({
      type: 'tool_call',
      id: 'call-exp',
      payload: {
        tool: 'dispatch_to_conductor',
        params: { task: 'fairy.intent' },
        context: {
          experiment_id: 'voice_toolset_factorial_v1',
          variant_id: 'v07',
          factor_levels: {
            initial_toolset: 'lean_adaptive',
          },
        },
      },
    });

    expect(parsed).not.toBeNull();
    expect((parsed?.payload.context as Record<string, unknown>).experiment_id).toBe(
      'voice_toolset_factorial_v1',
    );
  });

  it('rejects invalid tool_call messages', () => {
    const parsed = parseToolCallMessage({
      type: 'tool_call',
      payload: { tool: '' },
    });

    expect(parsed).toBeNull();
  });

  it('parses typed steward_trigger messages', () => {
    const parsed = parseStewardTriggerMessage({
      type: 'steward_trigger',
      payload: {
        kind: 'canvas',
        room: 'room-1',
        summary: 'draw architecture',
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.payload.kind).toBe('canvas');
  });

  it('parses decision messages and tolerates optional decision payload', () => {
    const parsed = parseDecisionMessage({
      type: 'decision',
      payload: {
        originalText: 'show weather for boston',
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.payload.originalText).toBe('show weather for boston');
  });

  it('validates tool_result messages', () => {
    const result = ToolResultMessageSchema.safeParse({
      type: 'tool_result',
      payload: {
        tool: 'create_component',
        status: 'SUCCESS',
        result: { id: 'x' },
      },
    });

    expect(result.success).toBe(true);
  });
});
