jest.mock('@tldraw/tldraw', () => ({
  toRichText: (text: string) => text,
  PageRecordType: {
    createId: () => 'page-generated',
  },
}), { virtual: true });

import { applyEnvelope } from './tldraw-actions';
import { ACTION_VERSION } from '@/lib/canvas-agent/contract/types';

type ShapeRecord = {
  id: string;
  type: string;
  x: number;
  y: number;
  props?: Record<string, unknown>;
};

function createMockEditor(initial: ShapeRecord[] = []) {
  const calls: any[] = [];
  const shapeMap = new Map(initial.map((shape) => [shape.id, { ...shape }]));
  const editor = {
    calls,
    createShapes: (shapes: any[]) => {
      calls.push(['createShapes', shapes]);
      shapes.forEach((shape) => {
        shapeMap.set(shape.id, { ...shape, props: { ...(shape.props ?? {}) } });
      });
    },
    updateShapes: (updates: any[]) => {
      calls.push(['updateShapes', updates]);
      updates.forEach((update) => {
        const current = shapeMap.get(update.id) ?? { id: update.id, type: update.type, x: 0, y: 0, props: {} };
        shapeMap.set(update.id, {
          ...current,
          ...('x' in update ? { x: update.x } : {}),
          ...('y' in update ? { y: update.y } : {}),
          props: { ...(current.props ?? {}), ...(update.props ?? {}) },
        });
      });
    },
    deleteShapes: (ids: any[]) => {
      calls.push(['deleteShapes', ids]);
      ids.forEach((id) => shapeMap.delete(id));
    },
    zoomToBounds: (bounds: any, options: any) => calls.push(['zoomToBounds', bounds, options]),
    fitBoundsToContent: (ids: any, opts: any) => calls.push(['fitBoundsToContent', ids, opts]),
    bringToFront: (ids: any) => calls.push(['bringToFront', ids]),
    sendToBack: (ids: any) => calls.push(['sendToBack', ids]),
    bringForward: (ids: any) => calls.push(['bringForward', ids]),
    sendBackward: (ids: any) => calls.push(['sendBackward', ids]),
    getPages: jest.fn(() => [{ id: 'page-1', name: 'Page 1' }]),
    createPage: jest.fn((page: any) => calls.push(['createPage', page])),
    setCurrentPage: jest.fn((pageId: string) => calls.push(['setCurrentPage', pageId])),
    getShape: (id: string) => shapeMap.get(id) ?? null,
    getShapePageBounds: (id: string) => {
      const shape = shapeMap.get(id);
      if (!shape) return null;
      const w = typeof shape.props?.w === 'number' ? shape.props.w : 0;
      const h = typeof shape.props?.h === 'number' ? shape.props.h : 0;
      return { minX: shape.x ?? 0, minY: shape.y ?? 0, maxX: (shape.x ?? 0) + w, maxY: (shape.y ?? 0) + h };
    },
    createShapeId: () => 'generated-id',
    _shapes: shapeMap,
  } as any;
  return editor;
}

function makeEnvelope(action: any): any {
  return {
    v: ACTION_VERSION,
    sessionId: 'session-1',
    seq: 1,
    ts: Date.now(),
    partial: false,
    actions: [action],
  };
}

describe('tldraw action handlers', () => {
  it('preserves note shapes for sticky-note creates', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-note',
        name: 'create_shape',
        params: {
          id: 'sticky-1',
          type: 'note',
          x: 24,
          y: 48,
          props: {
            text: 'BUNNY_LOOKS_ENERGETIC',
            color: 'yellow',
            size: 'm',
          },
        },
      }),
    );

    const createCall = editor.calls.find((c: any[]) => c[0] === 'createShapes');
    expect(createCall).toBeTruthy();
    const createdShape = createCall[1][0];
    expect(createdShape.type).toBe('note');
    expect(createdShape.props.text).toBeUndefined();

    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][0].props.richText).toBe('BUNNY_LOOKS_ENERGETIC');
  });

  it('sanitizes line endPoint props into points tuples', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-line',
        name: 'create_shape',
        params: {
          id: 'line-1',
          type: 'line',
          x: -30,
          y: -160,
          props: {
            endPoint: { x: 10, y: 100 },
            endArrowType: 'arrow',
            color: 'red',
            dash: 'solid',
          },
        },
      }),
    );

    const createCall = editor.calls.find((c: any[]) => c[0] === 'createShapes');
    expect(createCall).toBeTruthy();
    const createdShape = createCall[1][0];
    expect(createdShape.type).toBe('line');
    expect(createdShape.props.endPoint).toBeUndefined();
    expect(createdShape.props.endArrowType).toBeUndefined();
    expect(createdShape.props.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 10, y: 100 },
    });
  });

  it('normalizes top-level line endpoints when props are omitted', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-line-top-level',
        name: 'create_shape',
        params: {
          id: 'line-top-level',
          type: 'line',
          x: -30,
          y: -160,
          startPoint: { x: -30, y: -160 },
          endPoint: { x: 20, y: -60 },
          color: 'red',
        },
      }),
    );

    const createCall = editor.calls.find((c: any[]) => c[0] === 'createShapes');
    expect(createCall).toBeTruthy();
    const createdShape = createCall[1][0];
    expect(createdShape.type).toBe('line');
    expect(createdShape.props.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 50, y: 100 },
    });
  });

  it('rebases absolute line points against provided x/y origin', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-line-absolute',
        name: 'create_shape',
        params: {
          id: 'forest-tree-1',
          type: 'line',
          x: -180,
          y: -20,
          props: {
            startPoint: { x: -180, y: -20 },
            endPoint: { x: -180, y: 150 },
            color: 'green',
            size: 'l',
          },
        },
      }),
    );

    const createCall = editor.calls.find((c: any[]) => c[0] === 'createShapes');
    expect(createCall).toBeTruthy();
    const createdShape = createCall[1][0];
    expect(createdShape.x).toBe(-180);
    expect(createdShape.y).toBe(-20);
    expect(createdShape.props.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 0, y: 170 },
    });
  });

  it('creates draw shapes when type=draw', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-1',
        name: 'create_shape',
        params: {
          type: 'draw',
          x: 10,
          y: 20,
          props: {
            segments: [
              {
                type: 'free',
                points: [
                  { x: 0, y: 0, z: 0.5 },
                  { x: 5, y: 5, z: 0.6 },
                ],
              },
            ],
            color: 'red',
            size: 'm',
          },
        },
      }),
    );
    const createCall = editor.calls.find((c: any[]) => c[0] === 'createShapes');
    expect(createCall).toBeTruthy();
    const createdShape = createCall[1][0];
    expect(createdShape.type).toBe('draw');
    expect(createdShape.props.segments?.[0]?.points).toHaveLength(2);
  });

  it('uses zoomToBounds for set_viewport when host', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-2',
        name: 'set_viewport',
        params: { bounds: { x: 0, y: 0, w: 100, h: 50 } },
      }),
    );
    const zoomCall = editor.calls.find((c: any[]) => c[0] === 'zoomToBounds');
    expect(zoomCall).toBeTruthy();
    expect(zoomCall[1]).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('batched resize updates props for geo/text and falls back for others', () => {
    const editor = createMockEditor([
      { id: 'shape:geo123', type: 'geo', x: 0, y: 0, props: { w: 20, h: 20 } },
      { id: 'shape:txt456', type: 'text', x: 0, y: 0, props: { w: 10, h: 10 } },
      { id: 'shape:draw789', type: 'draw', x: 0, y: 0, props: { w: 5, h: 5 } },
    ]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'resize',
        name: 'resize',
        params: { id: 'geo123', w: 40, h: 20 },
      }),
    );
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'resize-2',
        name: 'resize',
        params: { id: 'txt456', w: 30, h: 10 },
      }),
    );
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'resize-3',
        name: 'resize',
        params: { id: 'draw789', w: 10, h: 10 },
      }),
    );
    const updateCalls = editor.calls.filter((c: any[]) => c[0] === 'updateShapes');
    expect(updateCalls).toHaveLength(2);
    const fitCall = editor.calls.find((c: any[]) => c[0] === 'fitBoundsToContent');
    expect(fitCall).toBeTruthy();
  });

  it('aligns shapes along axis with batching', () => {
    const editor = createMockEditor([
      { id: 'shape:a', type: 'geo', x: 0, y: 0, props: { w: 20, h: 20 } },
      { id: 'shape:b', type: 'geo', x: 100, y: 10, props: { w: 30, h: 30 } },
      { id: 'shape:c', type: 'geo', x: 200, y: 5, props: { w: 10, h: 10 } },
    ]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'align-1',
        name: 'align',
        params: { ids: ['a', 'b', 'c'], axis: 'x', mode: 'center' },
      }),
    );
    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const updates = updateCall[1];
    expect(updates.some((u: any) => u.id === 'shape:a')).toBe(true);
  });

  it('distributes shapes across axis', () => {
    const editor = createMockEditor([
      { id: 'shape:a', type: 'geo', x: 0, y: 0, props: { w: 10, h: 10 } },
      { id: 'shape:b', type: 'geo', x: 40, y: 0, props: { w: 10, h: 10 } },
      { id: 'shape:c', type: 'geo', x: 120, y: 0, props: { w: 10, h: 10 } },
    ]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'distribute-1',
        name: 'distribute',
        params: { ids: ['a', 'b', 'c'], axis: 'x' },
      }),
    );
    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const updates = updateCall[1];
    expect(updates.length).toBeGreaterThan(0);
  });

  it('honors absolute targets for move actions', () => {
    const editor = createMockEditor([
      { id: 'shape:a', type: 'geo', x: 10, y: 20, props: { w: 50, h: 40 } },
    ]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'move-absolute',
        name: 'move',
        params: { ids: ['a'], target: { x: 200, y: 300 } },
      }),
    );
    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const [{ x, y }] = updateCall[1];
    expect(x).toBeGreaterThanOrEqual(200);
    expect(y).toBeGreaterThanOrEqual(300);
  });

  it('applies x/y overrides via update_shape', () => {
    const editor = createMockEditor([{ id: 'shape:text1', type: 'text', x: 0, y: 0, props: { text: 'hi' } }]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'update-shape',
        name: 'update_shape',
        params: { id: 'text1', props: { text: 'updated' }, x: 120, y: 80 },
      }),
    );
    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const [{ x, y, props }] = updateCall[1];
    expect(x).toBe(120);
    expect(y).toBe(80);
    expect(props.text).toBeUndefined();
    expect(props.richText).toBeDefined();
  });

  it('sanitizes line update props to avoid invalid endpoint payloads', () => {
    const editor = createMockEditor([
      {
        id: 'shape:line-1',
        type: 'line',
        x: 0,
        y: 0,
        props: {
          points: {
            a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
            a2: { id: 'a2', index: 'a2', x: 20, y: 20 },
          },
        },
      },
    ]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'line-update-invalid',
        name: 'update_shape',
        params: {
          id: 'line-1',
          props: {
            endPoint: { x: 100, y: 0 },
            endArrowType: 'arrow',
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
            color: 'green',
          },
        },
      }),
    );

    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const update = updateCall[1][0];
    expect(update.props.endPoint).toBeUndefined();
    expect(update.props.endArrowType).toBeUndefined();
    expect(update.props.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 100, y: 0 },
    });
  });

  it('places a shape relative to a reference shape', () => {
    const editor = createMockEditor([
      { id: 'shape:bunny', type: 'geo', x: 50, y: 40, props: { w: 100, h: 80 } },
      { id: 'shape:sticky', type: 'note', x: 0, y: 0, props: { w: 40, h: 20 } },
    ]);

    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'place-sticky',
        name: 'place',
        params: {
          shapeId: 'sticky',
          referenceShapeId: 'bunny',
          side: 'right',
          align: 'center',
          sideOffset: 10,
          alignOffset: 5,
        },
      }),
    );

    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const placed = updateCall[1][0];
    expect(placed.id).toBe('shape:sticky');
    expect(placed.x).toBe(160);
    expect(placed.y).toBe(75);
  });

  it('supports scale-style resize payloads for multi-shape updates', () => {
    const editor = createMockEditor([
      { id: 'shape:geo-a', type: 'geo', x: 10, y: 20, props: { w: 20, h: 10 } },
      {
        id: 'shape:line-a',
        type: 'line',
        x: 0,
        y: 0,
        props: {
          points: {
            a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
            a2: { id: 'a2', index: 'a2', x: 10, y: 10 },
          },
        },
      },
    ]);

    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'scale-resize',
        name: 'resize',
        params: {
          shapeIds: ['geo-a', 'line-a'],
          originX: 0,
          originY: 0,
          scaleX: 2,
          scaleY: 3,
        },
      }),
    );

    const updateCall = editor.calls.find((c: any[]) => c[0] === 'updateShapes');
    expect(updateCall).toBeTruthy();
    const updates = updateCall[1];
    const geoUpdate = updates.find((entry: any) => entry.id === 'shape:geo-a');
    const lineUpdate = updates.find((entry: any) => entry.id === 'shape:line-a');
    expect(geoUpdate).toMatchObject({
      x: 20,
      y: 60,
      props: { w: 40, h: 30 },
    });
    expect(lineUpdate?.props?.points).toEqual({
      a1: { id: 'a1', index: 'a1', x: 0, y: 0 },
      a2: { id: 'a2', index: 'a2', x: 20, y: 30 },
    });
  });

  it('creates a page and switches focus when create-page is requested', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'create-page-1',
        name: 'create-page',
        params: {
          pageName: 'Storyboard',
          switchToPage: true,
        },
      }),
    );

    const createPageCall = editor.calls.find((c: any[]) => c[0] === 'createPage');
    expect(createPageCall).toBeTruthy();
    expect(createPageCall[1]).toMatchObject({ name: 'Storyboard' });
    const setCurrentCall = editor.calls.find((c: any[]) => c[0] === 'setCurrentPage');
    expect(setCurrentCall).toBeTruthy();
  });

  it('switches to an existing page for change-page', () => {
    const editor = createMockEditor();
    editor.getPages = jest.fn(() => [
      { id: 'page-1', name: 'Page 1' },
      { id: 'page-2', name: 'Storyboard' },
    ]);
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'change-page-1',
        name: 'change-page',
        params: {
          pageName: 'Storyboard',
        },
      }),
    );

    const setCurrentCall = editor.calls.find((c: any[]) => c[0] === 'setCurrentPage');
    expect(setCurrentCall).toBeTruthy();
    expect(setCurrentCall[1]).toBe('page-2');
  });
});
