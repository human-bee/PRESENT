jest.mock('@tldraw/tldraw', () => ({
  toRichText: (text: string) => text,
}), { virtual: true });

import { applyEnvelope } from './tldraw-actions';
import { ACTION_VERSION } from '@/lib/agents/canvas-agent/shared/types';

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
    getShape: (id: string) => shapeMap.get(id) ?? null,
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
  it('creates draw_pen shapes with free segment', () => {
    const editor = createMockEditor();
    applyEnvelope(
      { editor, isHost: true, appliedIds: new Set() },
      makeEnvelope({
        id: 'action-1',
        name: 'draw_pen',
        params: { x: 10, y: 20, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      }),
    );
    const createCall = editor.calls.find((c: any[]) => c[0] === 'createShapes');
    expect(createCall).toBeTruthy();
    const createdShape = createCall[1][0];
    expect(createdShape.type).toBe('draw');
    expect(createdShape.props.segments[0].type).toBe('free');
    expect(createdShape.props.segments[0].points).toHaveLength(2);
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
});
