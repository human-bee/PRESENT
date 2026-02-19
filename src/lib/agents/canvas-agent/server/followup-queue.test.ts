import { describe, expect, it, jest } from '@jest/globals';
import {
  buildFollowupFingerprint,
  buildFollowupRequestId,
  enqueueCanvasFollowup,
  type CanvasFollowupInput,
} from './followup-queue';

describe('followup-queue', () => {
  const followupInput: CanvasFollowupInput = {
    message: 'Add headline hierarchy',
    originalMessage: 'Draw a poster',
    depth: 2,
    hint: 'Use stronger typographic contrast',
    targetIds: ['shape:b', 'shape:a', 'shape:a'],
    strict: true,
    reason: 'low_action',
  };

  it('builds stable fingerprints and request ids', () => {
    const correlation = {
      requestId: 'req-1',
      traceId: 'trace-1',
      intentId: 'intent-1',
    };

    const fingerprintA = buildFollowupFingerprint('room-1', correlation, followupInput);
    const fingerprintB = buildFollowupFingerprint('room-1', correlation, {
      ...followupInput,
      targetIds: ['shape:a', 'shape:b'],
    });
    expect(fingerprintA).toBe(fingerprintB);

    const requestIdA = buildFollowupRequestId('room-1', correlation, followupInput);
    const requestIdB = buildFollowupRequestId('room-1', correlation, {
      ...followupInput,
      targetIds: ['shape:b', 'shape:a'],
    });
    expect(requestIdA).toBe(requestIdB);
    expect(requestIdA).toContain('d2');
  });

  it('enqueues a durable followup task with dedupe key and correlation payload', async () => {
    const enqueueTask = jest.fn(async () => ({ id: 'task-1' }));
    const accepted = await enqueueCanvasFollowup(
      {
        queue: { enqueueTask } as any,
        roomId: 'room-1',
        sessionId: 'session-1',
        correlation: {
          requestId: 'req-1',
          traceId: 'trace-1',
          intentId: 'intent-1',
        },
        metadata: { contextProfile: 'deep', runtimeScope: 'ws://localhost:7880' },
      },
      followupInput,
    );

    expect(accepted).toBe(true);
    expect(enqueueTask).toHaveBeenCalledTimes(1);
    const [payload] = enqueueTask.mock.calls[0] as [Record<string, any>];
    expect(payload.task).toBe('canvas.followup');
    expect(payload.room).toBe('room-1');
    expect(payload.requestId).toContain('req-1');
    expect(payload.dedupeKey).toHaveLength(20);
    expect(payload.params.depth).toBe(2);
    expect(payload.params.traceId).toBe('trace-1');
    expect(payload.params.intentId).toBe('intent-1');
    expect(payload.params.runtimeScope).toBe('localhost:7880');
    expect(payload.params.selectionIds).toEqual(['shape:a', 'shape:b']);
    expect(payload.params.followup).toMatchObject({
      reason: 'low_action',
      depth: 2,
      strict: true,
    });
    expect(payload.params.metadata.followup).toMatchObject({
      depth: 2,
      parentSessionId: 'session-1',
    });
    expect(payload.resourceKeys).toEqual(
      expect.arrayContaining(['runtime-scope:localhost:7880']),
    );
  });

  it('rejects empty followups without hitting the queue', async () => {
    const enqueueTask = jest.fn(async () => ({ id: 'task-1' }));
    const accepted = await enqueueCanvasFollowup(
      {
        queue: { enqueueTask } as any,
        roomId: 'room-1',
        sessionId: 'session-1',
      },
      {
        message: '  ',
        originalMessage: 'Draw a poster',
        depth: 1,
      },
    );
    expect(accepted).toBe(false);
    expect(enqueueTask).not.toHaveBeenCalled();
  });
});
