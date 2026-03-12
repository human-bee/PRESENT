import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentAdminPage from './page';

const fetchWithSupabaseAuthMock = jest.fn();

jest.mock('@/lib/supabase/auth-headers', () => ({
  fetchWithSupabaseAuth: (...args: unknown[]) => fetchWithSupabaseAuthMock(...args),
}));

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

const response = (body: unknown, status = 200): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('/admin/agents page', () => {
  beforeEach(() => {
    fetchWithSupabaseAuthMock.mockReset();
  });

  it('supports pretty/raw payload rendering and masking toggle', async () => {
    const calledUrls: string[] = [];
    fetchWithSupabaseAuthMock.mockImplementation((url: string) => {
      calledUrls.push(url);
      if (url === '/api/admin/agents/overview') {
        return Promise.resolve(
          response({
            ok: true,
            actorUserId: 'user-1',
            actorAccessMode: 'open_access',
            safeActionsAllowed: false,
            detailMaskDefault: true,
            queue: { queued: 0, running: 1, failed: 1, succeeded: 0, canceled: 0 },
            tracesLastHour: 2,
            activeWorkers: 1,
            workers: [],
            generatedAt: '2026-02-17T12:00:00.000Z',
          }),
        );
      }
      if (url.startsWith('/api/admin/agents/queue')) {
        return Promise.resolve(
          response({
            tasks: [
              {
                id: 'task-1',
                room: 'canvas-room-1',
                task: 'fairy.intent',
                status: 'failed',
                priority: 100,
                attempt: 2,
                trace_id: 'trace-1',
                worker_id: 'worker-1',
                last_failure_reason: 'model timeout',
                provider: 'openai',
                model: 'gpt-5-mini',
                provider_source: 'task_params',
                provider_path: 'primary',
                created_at: '2026-02-17T12:00:00.000Z',
              },
            ],
          }),
        );
      }
      if (url.startsWith('/api/admin/agents/traces?')) {
        return Promise.resolve(
          response({
            traces: [
              {
                id: 'evt-list-1',
                trace_id: 'trace-1',
                stage: 'failed',
                status: 'failed',
                task: 'fairy.intent',
                room: 'canvas-room-1',
                subsystem: 'worker',
                failure_reason: 'model timeout',
                provider: 'openai',
                model: 'gpt-5-mini',
                provider_source: 'task_params',
                provider_path: 'primary',
              },
            ],
          }),
        );
      }
      if (url.startsWith('/api/admin/agents/voice-sessions')) {
        return Promise.resolve(
          response({
            available: true,
            toolIoAvailable: true,
            sessions: [
              {
                session_id: 'voice-1',
                room: 'canvas-room-1',
                status: 'running',
                started_at: '2026-02-17T12:00:00.000Z',
                closed_at: null,
                last_activity_at: '2026-02-17T12:00:01.000Z',
                provider: 'openai',
                model: 'gpt-realtime-1.5',
                provider_source: 'runtime_selected',
                provider_path: 'primary',
                provider_request_id: 'provider-voice-1',
                trace_id: 'trace-1',
                request_id: 'req-voice-1',
                intent_id: 'intent-voice-1',
                event_count: 2,
                tool_event_count: 1,
                tool_call_count: 1,
                last_tool_name: 'dispatch_to_conductor',
                config_version: 'cfg-1',
                control_scope: 'global',
                control_scope_id: 'global',
                control_profile_id: 'profile-1',
                worker_id: 'worker-voice-1',
                participant_identity: 'voice-agent-1',
                close_reason: null,
                close_code: null,
                close_error: null,
              },
            ],
          }),
        );
      }
      if (url === '/api/admin/agents/workers') {
        return Promise.resolve(response({ workers: [] }));
      }
      if (url.startsWith('/api/admin/agents/audit')) {
        return Promise.resolve(response({ entries: [] }));
      }
      if (url === '/api/traces/trace-1') {
        return Promise.resolve(
          response({
            events: [
              {
                id: 'evt-1',
                trace_id: 'trace-1',
                stage: 'failed',
                status: 'failed',
                task: 'fairy.intent',
                room: 'canvas-room-1',
                payload: { secret: 'abc123' },
                subsystem: 'worker',
                failure_reason: 'model timeout',
                provider: 'openai',
                model: 'gpt-5-mini',
                provider_source: 'task_params',
                provider_path: 'primary',
              },
            ],
          }),
        );
      }
      if (url.startsWith('/api/admin/agents/traces/trace-1/context')) {
        return Promise.resolve(
          response({
            ok: true,
            actorUserId: 'user-1',
            traceId: 'trace-1',
            failure: {
              status: 'failed',
              stage: 'failed',
              subsystem: 'worker',
              reason: 'model timeout',
              created_at: '2026-02-17T12:00:00.000Z',
              trace_id: 'trace-1',
              request_id: 'req-1',
              intent_id: 'intent-1',
              task_id: 'task-1',
              task: 'fairy.intent',
              worker_id: 'worker-1',
              provider: 'openai',
              model: 'gpt-5-mini',
              provider_source: 'task_params',
              provider_path: 'primary',
              provider_request_id: 'provider-1',
              provider_context_url: null,
            },
            taskSnapshot: {
              id: 'task-1',
              room: 'canvas-room-1',
              task: 'fairy.intent',
              status: 'failed',
              attempt: 2,
              error: 'model timeout',
              request_id: 'req-1',
              trace_id: 'trace-1',
              created_at: '2026-02-17T11:59:00.000Z',
              updated_at: '2026-02-17T12:00:01.000Z',
            },
            transcriptPage: {
              room: 'canvas-room-1',
              sessionId: null,
              direction: 'latest',
              entries: [],
              hasOlder: false,
              hasNewer: false,
              beforeTs: null,
              afterTs: null,
              nextBeforeTs: null,
              nextAfterTs: null,
            },
          }),
        );
      }
      return Promise.resolve(response({ error: `Unhandled URL: ${url}` }, 500));
    });

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentAdminPage />);

    await screen.findByText('Voice Sessions');
    expect(await screen.findByText('gpt-realtime-1.5')).toBeTruthy();

    const queueTask = await screen.findByText('fairy.intent');
    fireEvent.click(queueTask);

    await screen.findByText('Trace Detail');

    await waitFor(() => {
      expect(
        calledUrls.some((url) => url.startsWith('/api/admin/agents/queue?') && url.includes('traceId=trace-1')),
      ).toBe(true);
      expect(
        calledUrls.some((url) => url.startsWith('/api/admin/agents/traces?') && url.includes('traceId=trace-1')),
      ).toBe(true);
      expect(
        calledUrls.some(
          (url) =>
            url.startsWith('/api/admin/agents/voice-sessions?') &&
            url.includes('traceId=trace-1'),
        ),
      ).toBe(true);
    });

    fireEvent.click(await screen.findByText('Show Payload'));

    await waitFor(() => {
      expect(screen.getByText(/"secret": "\[masked\]"/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Raw JSON'));
    await waitFor(() => {
      expect(screen.getByText('{"secret":"[masked]"}')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Mask Sensitive: On'));
    await waitFor(() => {
      expect(screen.getByText('{"secret":"abc123"}')).toBeTruthy();
    });

    confirmSpy.mockRestore();
  });
});
