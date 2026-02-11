import {
  buildToolEvent,
  coerceComponentPatch,
  shouldForceReliableUpdate,
} from '../tool-publishing';

describe('voice-agent tool publishing helpers', () => {
  it('builds tool_call events with expected shape', () => {
    const event = buildToolEvent('create_component', { type: 'RetroTimerEnhanced' }, 'room-a');
    expect(event.type).toBe('tool_call');
    expect(event.roomId).toBe('room-a');
    expect(event.payload.tool).toBe('create_component');
    expect(event.payload.params).toEqual({ type: 'RetroTimerEnhanced' });
    expect(typeof event.id).toBe('string');
  });

  it('forces reliable update when instruction patch is present', () => {
    expect(
      shouldForceReliableUpdate('update_component', { patch: { instruction: 'summarize this' } } as any),
    ).toBe(true);
    expect(shouldForceReliableUpdate('update_component', { patch: {} } as any)).toBe(false);
    expect(
      shouldForceReliableUpdate('create_component', { patch: { instruction: 'x' } } as any),
    ).toBe(false);
  });

  it('coerces string patch into instruction fallback when json is invalid', () => {
    expect(coerceComponentPatch('set to 10 minutes')).toEqual({ instruction: 'set to 10 minutes' });
  });
});
