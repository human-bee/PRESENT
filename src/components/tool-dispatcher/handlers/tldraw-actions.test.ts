jest.mock('@tldraw/tldraw', () => ({
  toRichText: (text: string) => text,
}), { virtual: true });

import { applyAction } from './tldraw-actions';

function createMockEditor() {
  const calls: any[] = [];
  return {
    calls,
    createShape: (shape: any) => calls.push(['createShape', shape]),
    zoomToBounds: (bounds: any, options: any) => calls.push(['zoomToBounds', bounds, options]),
    updateShapes: (payload: any) => calls.push(['updateShapes', payload]),
    fitBoundsToContent: (ids: any, opts: any) => calls.push(['fitBoundsToContent', ids, opts]),
    getShape: (id: string) => ({ id, type: id.startsWith('shape:geo') ? 'geo' : id.startsWith('shape:txt') ? 'text' : 'draw', props: {} }),
    createShapeId: () => 'generated-id',
  } as any;
}

describe('tldraw action handlers', () => {
  it('creates draw shape with free segment for draw_pen', () => {
    const editor = createMockEditor();
    applyAction({ editor, isHost: true, appliedIds: new Set() }, {
      id: 'action-1',
      name: 'draw_pen',
      params: { x: 10, y: 20, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    } as any);
    const [method, payload] = editor.calls[0];
    expect(method).toBe('createShape');
    expect(payload.props.segments[0].type).toBe('free');
    expect(payload.props.segments[0].points).toHaveLength(2);
  });

  it('uses zoomToBounds for set_viewport', () => {
    const editor = createMockEditor();
    applyAction({ editor, isHost: true, appliedIds: new Set() }, {
      id: 'action-2',
      name: 'set_viewport',
      params: { bounds: { x: 0, y: 0, w: 100, h: 50 } },
    } as any);
    const [method, bounds, options] = editor.calls[0];
    expect(method).toBe('zoomToBounds');
    expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(options?.inset).toBe(32);
  });

  it('resizes geo/text directly and falls back for other shapes', () => {
    const editor = createMockEditor();
    applyAction({ editor, isHost: true, appliedIds: new Set() }, {
      id: 'action-3',
      name: 'resize',
      params: { id: 'geo123', w: 40, h: 20 },
    } as any);
    applyAction({ editor, isHost: true, appliedIds: new Set() }, {
      id: 'action-4',
      name: 'resize',
      params: { id: 'txt456', w: 30, h: 10 },
    } as any);
    applyAction({ editor, isHost: true, appliedIds: new Set() }, {
      id: 'action-5',
      name: 'resize',
      params: { id: 'draw789', w: 10, h: 10 },
    } as any);

    expect(editor.calls[0][0]).toBe('updateShapes');
    expect(editor.calls[1][0]).toBe('updateShapes');
    expect(editor.calls[2][0]).toBe('fitBoundsToContent');
  });
});
