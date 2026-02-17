/**
 * @jest-environment node
 */

const getAdminSupabaseClientMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();

jest.mock('@/lib/agents/admin/supabase-admin', () => ({
  getAdminSupabaseClient: getAdminSupabaseClientMock,
}));

jest.mock('@/lib/agents/shared/canvas-billing', () => ({
  assertCanvasMember: assertCanvasMemberMock,
  parseCanvasIdFromRoom: parseCanvasIdFromRoomMock,
}));

jest.mock('@/lib/supabase/server/resolve-request-user', () => ({
  resolveRequestUserId: resolveRequestUserIdMock,
}));

const loadGet = async () => {
  let GET: ((req: import('next/server').NextRequest) => Promise<Response>) | null = null;
  await jest.isolateModulesAsync(async () => {
    const route = await import('./route');
    GET = route.GET;
  });
  return GET as (req: import('next/server').NextRequest) => Promise<Response>;
};

describe('/api/steward/task-status', () => {
  beforeEach(() => {
    getAdminSupabaseClientMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();
    resolveRequestUserIdMock.mockReset();

    resolveRequestUserIdMock.mockResolvedValue('user-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
  });

  it('returns 401 when requester is not authenticated', async () => {
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/task-status?taskId=task-1&room=canvas-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('returns 404 when task id is not found', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({ data: null, error: null });
    const eqMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => ({ select: selectMock })),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL(
        'http://localhost/api/steward/task-status?taskId=task-missing&room=canvas-1',
      ),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('task not found');
  });

  it('returns task status when requester is a canvas member', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'task-1',
        room: 'canvas-1',
        task: 'fairy.intent',
        status: 'succeeded',
        attempt: 1,
        error: null,
        result: { ok: true },
        request_id: 'req-1',
        created_at: '2026-02-17T01:00:00.000Z',
        updated_at: '2026-02-17T01:00:05.000Z',
      },
      error: null,
    });
    const eqMock = jest.fn(() => ({ maybeSingle: maybeSingleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    getAdminSupabaseClientMock.mockReturnValue({
      from: jest.fn(() => ({ select: selectMock })),
    });

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/task-status?taskId=task-1&room=canvas-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.task.id).toBe('task-1');
    expect(json.task.status).toBe('succeeded');
    expect(json.task.requestId).toBe('req-1');
    expect(assertCanvasMemberMock).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      requesterUserId: 'user-1',
    });
  });
});
