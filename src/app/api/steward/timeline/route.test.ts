/**
 * @jest-environment node
 */

const getTimelineDocumentMock = jest.fn();
const assertCanvasMemberMock = jest.fn();
const parseCanvasIdFromRoomMock = jest.fn();
const resolveRequestUserIdMock = jest.fn();

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  getTimelineDocument: getTimelineDocumentMock,
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

describe('/api/steward/timeline', () => {
  const originalDevBypass = process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = 'false';
    process.env.NODE_ENV = 'test';
    getTimelineDocumentMock.mockReset();
    assertCanvasMemberMock.mockReset();
    parseCanvasIdFromRoomMock.mockReset();
    resolveRequestUserIdMock.mockReset();

    resolveRequestUserIdMock.mockResolvedValue('user-1');
    parseCanvasIdFromRoomMock.mockReturnValue('canvas-1');
    assertCanvasMemberMock.mockResolvedValue({ ownerUserId: 'owner-1' });
    getTimelineDocumentMock.mockResolvedValue({
      document: {
        componentId: 'timeline-1',
        title: 'Platform Roadmap',
        subtitle: 'Cross-team launch plan',
        horizonLabel: 'Q2 2026',
        lanes: [
          { id: 'lane-product', name: 'Product', kind: 'team', order: 0 },
          { id: 'lane-engineering', name: 'Engineering', kind: 'team', order: 1 },
        ],
        items: [
          {
            id: 'item-1',
            laneId: 'lane-product',
            title: 'Finalize launch brief',
            type: 'milestone',
            status: 'in_progress',
            tags: [],
            blockedBy: [],
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
        ],
        dependencies: [],
        events: [],
        sync: { status: 'live', pendingExports: [] },
        version: 5,
        lastUpdated: 1700000001000,
      },
      version: 5,
      lastUpdated: 1700000001000,
    });
  });

  afterAll(() => {
    if (originalDevBypass === undefined) {
      delete process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS;
    } else {
      process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = originalDevBypass;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('returns 401 when requester is not authenticated', async () => {
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=canvas-1&componentId=timeline-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('returns 400 when room/componentId is missing', async () => {
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=canvas-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('room and componentId are required');
  });

  it('returns 400 when room does not map to a canvas', async () => {
    parseCanvasIdFromRoomMock.mockReturnValueOnce(null);
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=ephemeral-room&componentId=timeline-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('invalid room');
  });

  it('returns canonical timeline payload for verified members', async () => {
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=canvas-1&componentId=timeline-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.room).toBe('canvas-1');
    expect(json.componentId).toBe('timeline-1');
    expect(json.document.title).toBe('Platform Roadmap');
    expect(json.document.lanes).toHaveLength(2);
    expect(json.version).toBe(5);
    expect(json.lastUpdated).toBe(1700000001000);
    expect(json.diagnostics.membership).toBe('verified');
    expect(assertCanvasMemberMock).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      requesterUserId: 'user-1',
    });
  });

  it('returns 403 when requester is not a canvas member', async () => {
    const err = new Error('Forbidden') as Error & { code?: string };
    err.code = 'forbidden';
    assertCanvasMemberMock.mockRejectedValueOnce(err);

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=canvas-1&componentId=timeline-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('forbidden');
  });

  it('returns 404 when the canonical timeline does not exist', async () => {
    getTimelineDocumentMock.mockRejectedValueOnce(new Error('TIMELINE_NOT_FOUND'));

    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=canvas-1&componentId=timeline-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('timeline not found');
  });

  it('allows unauthenticated access when dev bypass is enabled', async () => {
    process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS = 'true';
    resolveRequestUserIdMock.mockResolvedValueOnce(null);
    const GET = await loadGet();
    const response = await GET({
      nextUrl: new URL('http://localhost/api/steward/timeline?room=canvas-1&componentId=timeline-1'),
    } as import('next/server').NextRequest);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.diagnostics.membership).toBe('dev_bypass');
    expect(assertCanvasMemberMock).not.toHaveBeenCalled();
  });
});
