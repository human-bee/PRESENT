import React from 'react';
import { act, render, waitFor, cleanup } from '@testing-library/react';
import { useRoomExecutor } from './use-room-executor';

const fetchWithSupabaseAuthMock = jest.fn();

jest.mock('@/lib/supabase/auth-headers', () => ({
  fetchWithSupabaseAuth: (...args: any[]) => fetchWithSupabaseAuthMock(...args),
}));

type RoomLike = {
  name: string;
  state: string;
  localParticipant?: { identity: string };
};

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function HookProbe({
  room,
  onState,
}: {
  room: RoomLike;
  onState: (state: ReturnType<typeof useRoomExecutor>) => void;
}) {
  const state = useRoomExecutor(room as any);
  React.useEffect(() => onState(state), [onState, state]);
  return null;
}

describe('useRoomExecutor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchWithSupabaseAuthMock.mockReset();
    (window as any).__present = {
      sessionSync: {
        sessionId: '11111111-1111-1111-1111-111111111111',
        roomName: 'canvas-11111111-1111-1111-1111-111111111111',
      },
    };
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('claims executor lease when available', async () => {
    const successPayload = {
      acquired: true,
      executorIdentity: 'alice',
      leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
    };
    fetchWithSupabaseAuthMock.mockResolvedValueOnce(
      mockJsonResponse(successPayload),
    );
    fetchWithSupabaseAuthMock.mockResolvedValueOnce(mockJsonResponse(successPayload));

    let lastState: any = null;
    render(
      <HookProbe
        room={{
          name: 'canvas-11111111-1111-1111-1111-111111111111',
          state: 'connected',
          localParticipant: { identity: 'alice' },
        }}
        onState={(state) => {
          lastState = state;
        }}
      />,
    );

    await waitFor(() => {
      expect(lastState?.isExecutor).toBe(true);
      expect(lastState?.status).toBe('active');
    });
  });

  it('stays standby when another executor owns the lease', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValueOnce(
      mockJsonResponse({
        acquired: false,
        executorIdentity: 'bob',
        leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
      }),
    );

    let lastState: any = null;
    render(
      <HookProbe
        room={{
          name: 'canvas-11111111-1111-1111-1111-111111111111',
          state: 'connected',
          localParticipant: { identity: 'alice' },
        }}
        onState={(state) => {
          lastState = state;
        }}
      />,
    );

    await waitFor(() => {
      expect(lastState?.isExecutor).toBe(false);
      expect(lastState?.executorIdentity).toBe('bob');
      expect(lastState?.status).toBe('standby');
    });
  });

  it('heartbeats when already executor', async () => {
    const successPayload = {
      acquired: true,
      executorIdentity: 'alice',
      leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
    };
    fetchWithSupabaseAuthMock
      .mockResolvedValueOnce(mockJsonResponse(successPayload))
      .mockResolvedValueOnce(mockJsonResponse({ ...successPayload, ok: true }));

    let lastState: any = null;
    render(
      <HookProbe
        room={{
          name: 'canvas-11111111-1111-1111-1111-111111111111',
          state: 'connected',
          localParticipant: { identity: 'alice' },
        }}
        onState={(state) => {
          lastState = state;
        }}
      />,
    );

    await waitFor(() => {
      expect(lastState?.isExecutor).toBe(true);
    });

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    await waitFor(() => {
      expect(fetchWithSupabaseAuthMock).toHaveBeenCalledWith(
        '/api/session/executor/heartbeat',
        expect.any(Object),
      );
    });
  });

  it('fails over to local identity after lease expiry', async () => {
    fetchWithSupabaseAuthMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          acquired: false,
          executorIdentity: 'bob',
          leaseExpiresAt: new Date(Date.now() + 500).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          acquired: true,
          executorIdentity: 'alice',
          leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          executorIdentity: 'alice',
          leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
        }),
      );

    let lastState: any = null;
    render(
      <HookProbe
        room={{
          name: 'canvas-11111111-1111-1111-1111-111111111111',
          state: 'connected',
          localParticipant: { identity: 'alice' },
        }}
        onState={(state) => {
          lastState = state;
        }}
      />,
    );

    await waitFor(() => {
      expect(lastState?.status).toBe('standby');
      expect(lastState?.executorIdentity).toBe('bob');
    });

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    await waitFor(() => {
      expect(lastState?.isExecutor).toBe(true);
      expect(lastState?.executorIdentity).toBe('alice');
      expect(lastState?.status).toBe('active');
    });
  });
});
