import { describe, expect, it } from '@jest/globals';
import { shouldReconnectForRoomSwitch } from './lk-room-switch';

describe('shouldReconnectForRoomSwitch', () => {
  it('returns true when connected room differs from requested room', () => {
    const result = shouldReconnectForRoomSwitch({
      previousRequestedRoom: 'canvas-old',
      nextRequestedRoom: 'canvas-new',
      connectionState: 'connected',
      connectedRoomName: 'canvas-old',
    });

    expect(result).toBe(true);
  });

  it('returns true when room switches while connecting', () => {
    const result = shouldReconnectForRoomSwitch({
      previousRequestedRoom: 'canvas-old',
      nextRequestedRoom: 'canvas-new',
      connectionState: 'connecting',
      connectedRoomName: '',
    });

    expect(result).toBe(true);
  });

  it('returns false when room did not change', () => {
    const result = shouldReconnectForRoomSwitch({
      previousRequestedRoom: 'canvas-same',
      nextRequestedRoom: 'canvas-same',
      connectionState: 'connected',
      connectedRoomName: 'canvas-same',
    });

    expect(result).toBe(false);
  });
});
