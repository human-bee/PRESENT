import { buildPromptParts } from './context';
import { getCanvasShapeSummary, getTranscriptWindow } from '@/lib/agents/shared/supabase-context';

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  getCanvasShapeSummary: jest.fn(),
  getTranscriptWindow: jest.fn(),
}));

const mockedCanvas = getCanvasShapeSummary as jest.MockedFunction<typeof getCanvasShapeSummary>;
const mockedTranscript = getTranscriptWindow as jest.MockedFunction<typeof getTranscriptWindow>;

describe('buildPromptParts', () => {
  beforeEach(() => {
    mockedCanvas.mockReset();
    mockedTranscript.mockReset();
    mockedCanvas.mockResolvedValue({ shapes: [], version: '10' });
    mockedTranscript.mockResolvedValue({ transcript: [] });
  });

  it('embeds screenshot metadata into prompt parts when provided', async () => {
    mockedCanvas.mockResolvedValue({
      shapes: [
        { id: 'shape', type: 'geo', x: 10, y: 20, w: 200, h: 100, meta: { width: 200, height: 100 } },
        { id: 'off', type: 'geo', x: 800, y: 900, w: 50, h: 50, meta: { width: 50, height: 50 } },
      ],
      version: '42',
      recentActions: [{ id: 'act-1', type: 'draw', summary: 'created sticky note' }],
    });

    const screenshotViewport = { x: 10, y: 20, w: 200, h: 100 };
    const parts = await buildPromptParts('room-1', {
      screenshot: {
        image: { dataUrl: 'data:image/png;base64,abc', mime: 'image/png', bytes: 1234 },
        viewport: screenshotViewport,
        selection: ['shape-1', 'shape-2'],
        docVersion: 'snapshot-9',
        bounds: screenshotViewport,
        requestId: 'req-123',
        receivedAt: 1700000000000,
      },
    });

    const data = parts as Record<string, any>;
    expect(data.viewport).toEqual(screenshotViewport);
    expect(data.selection).toEqual(['shape-1', 'shape-2']);
    expect(data.docVersion).toBe('snapshot-9');
    expect(data.viewportCenter).toEqual({ x: 110, y: 70 });
    expect(data.screenshot).toMatchObject({
      dataUrl: 'data:image/png;base64,abc',
      mime: 'image/png',
      bytes: 1234,
      bounds: screenshotViewport,
      requestId: 'req-123',
      receivedAt: 1700000000000,
    });
    expect(Array.isArray(data.blurryShapes)).toBe(true);
    expect(Array.isArray(data.peripheralClusters)).toBe(true);
    expect(Array.isArray(data.recentActions)).toBe(true);
  });

  it('falls back to provided viewport and selection when screenshot missing', async () => {
    const parts = await buildPromptParts('room-1', {
      viewport: { x: 5, y: 6, w: 7, h: 8 },
      selection: ['only-shape'],
    });

    const data = parts as Record<string, any>;
    expect(data.viewport).toEqual({ x: 5, y: 6, w: 7, h: 8 });
    expect(data.selection).toEqual(['only-shape']);
    expect(data.docVersion).toBe('10');
    expect(data.screenshot).toBeUndefined();
    expect(data.blurryShapes).toBeDefined();
    expect(data.peripheralClusters).toBeDefined();
  });
});
