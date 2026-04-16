import { resolveCanvasRoomHostState } from './useCanvasRoomHost';

const buildRoom = (overrides: Partial<Parameters<typeof resolveCanvasRoomHostState>[0]> = {}) => ({
  state: 'connected',
  localParticipant: {
    identity: 'operator-a',
    sid: 'PA_LOCAL',
    name: 'Operator A',
  },
  remoteParticipants: new Map<string, { identity: string; sid: string; name: string }>(),
  ...overrides,
});

describe('resolveCanvasRoomHostState', () => {
  it('elects the lexicographically first non-agent participant only when connected', () => {
    const room = buildRoom({
      remoteParticipants: new Map([
        ['operator-b', { identity: 'operator-b', sid: 'PA_REMOTE', name: 'Operator B' }],
      ]),
    });

    expect(resolveCanvasRoomHostState(room)).toEqual({
      isHost: true,
      hostId: 'operator-a',
    });
  });

  it('fails closed while the room is reconnecting', () => {
    const room = buildRoom({
      state: 'reconnecting',
    });

    expect(resolveCanvasRoomHostState(room)).toEqual({
      isHost: false,
      hostId: null,
    });
  });

  it('allows a local bootstrap host before the first room connection when explicitly enabled', () => {
    const room = buildRoom({
      state: 'disconnected',
    });

    expect(resolveCanvasRoomHostState(room, { allowStandaloneHost: true })).toEqual({
      isHost: true,
      hostId: 'operator-a',
    });
  });

  it('ignores agent identities when computing the room host', () => {
    const room = buildRoom({
      remoteParticipants: new Map([
        [
          'agent-voice',
          { identity: 'agent-voice', sid: 'PA_AGENT', name: 'Voice Agent' },
        ],
        [
          'operator-b',
          { identity: 'operator-b', sid: 'PA_REMOTE', name: 'Operator B' },
        ],
      ]),
    });

    expect(resolveCanvasRoomHostState(room)).toEqual({
      isHost: true,
      hostId: 'operator-a',
    });
  });
});
