import { deriveRequestCorrelation, normalizeCorrelationId } from '@/lib/agents/shared/request-correlation';

describe('request correlation helpers', () => {
  test('normalizes and bounds correlation ids', () => {
    expect(normalizeCorrelationId('  req-1  ')).toBe('req-1');
    expect(normalizeCorrelationId('')).toBeUndefined();
    expect(normalizeCorrelationId(null)).toBeUndefined();
    expect(normalizeCorrelationId(`x${'a'.repeat(200)}`)).toHaveLength(160);
  });

  test('prefers explicit top-level request id over params candidates', () => {
    const correlation = deriveRequestCorrelation({
      task: 'fairy.intent',
      requestId: 'top-level-id',
      params: {
        requestId: 'inner-id',
        id: 'fairy-id',
        executionId: 'exec-id',
      },
    });

    expect(correlation.requestId).toBe('top-level-id');
    expect(correlation.intentId).toBe('fairy-id');
    expect(correlation.traceId).toBe('top-level-id');
  });

  test('falls back through request id sources for dispatch payloads', () => {
    const correlation = deriveRequestCorrelation({
      task: 'canvas.agent_prompt',
      params: {
        executionId: 'exec-123',
      },
    });

    expect(correlation.requestId).toBe('exec-123');
    expect(correlation.intentId).toBe('exec-123');
    expect(correlation.traceId).toBe('exec-123');
  });

  test('extracts trace and intent metadata when provided', () => {
    const correlation = deriveRequestCorrelation({
      task: 'fairy.intent',
      params: {
        id: 'intent-55',
        metadata: {
          traceId: 'trace-abc',
          intentId: 'intent-from-metadata',
          _trace: { traceId: 'trace-nested', intentId: 'intent-nested' },
        },
      },
    });

    expect(correlation.requestId).toBe('intent-55');
    expect(correlation.intentId).toBe('intent-55');
    expect(correlation.traceId).toBe('trace-abc');
  });
});
