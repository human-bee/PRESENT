import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CanvasContextProvider, CanvasStill, CanvasViewContext } from '../shared/canvas-commands';
import { createCanvasContextSender } from '../src/voice/canvas-context';
import { createRealtimeEvents } from '../src/voice/realtime-events';

const view: CanvasViewContext = { pageId: 'page:page', selectedIds: ['shape:one'], viewport: { x: 10, y: 20, w: 600, h: 400 }, shapes: [{ id: 'shape:one', type: 'geo', x: 30, y: 30, text: 'Launch' }], capturedAt: 100 };
const still: CanvasStill = { dataUrl: 'data:image/png;base64,YWJj', scope: 'selection', caption: 'Selected native shapes.', capturedAt: 100, omittedWidgetIds: ['shape:html'] };
type Sent = { type: string; item?: { id?: string; content?: { type: string; text?: string; image_url?: string }[]; type?: string }; item_id?: string };

test('changed Editor observations are rate bounded and previous observations replaced without raster capture', () => {
  let now = 0, active = true, observed = structuredClone(view), captures = 0;
  const sent: Sent[] = [];
  const provider: CanvasContextProvider = { read: () => observed, capture: async () => { captures++; return still; } };
  const context = createCanvasContextSender({ current: () => active, provider: () => provider, now: () => now, send: value => sent.push(value as Sent) });
  context.publish(); assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'session.thinking.append');
  now = 2000; observed = { ...observed, capturedAt: 200 }; context.publish(); assert.equal(sent.length, 1);
  observed = { ...observed, selectedIds: [], viewport: { ...view.viewport, x: 80 } }; context.publish(); assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'session.thinking.append');
  now = 2500; observed = { ...observed, viewport: { ...view.viewport, x: 90 } }; context.publish(); assert.equal(sent.length, 2);
  now = 4000; active = false; context.publish(); assert.equal(sent.length, 2); assert.equal(captures, 0);
});

test('explicit still image precedes native tool output and continuation with omission caption and cooldown', async () => {
  const sent: Sent[] = []; let captures = 0;
  const provider: CanvasContextProvider = { read: () => view, capture: async () => { captures++; return still; } };
  const context = createCanvasContextSender({ current: () => true, provider: () => provider, now: () => 0, send: value => sent.push(value as Sent) });
  const events = createRealtimeEvents({ current: () => true, mode: () => 'ambient', send: value => sent.push(value as Sent), status: () => {}, error: error => { throw error; }, record: () => {}, execute: (_name, args) => context.readForTool(args) });
  const call = { type: 'function_call', call_id: 'native-read', name: 'read_canvas', arguments: JSON.stringify({ scope: 'selection', includeImage: true }) };
  await events({ type: 'response.event', delegation_id: 'd', event: { type: 'response.created', response: { id: 'response-native' } } });
  await events({ type: 'response.event', delegation_id: 'd', event: { type: 'response.output_item.done', item: call } });
  await events({ type: 'response.event', delegation_id: 'd', event: { type: 'response.completed', response: { id: 'response-native', output: [] } } });
  assert.equal(sent[0].item?.content?.[1].type, 'input_image');
  assert.match(sent[0].item?.id ?? '', /^msg_[a-f0-9]{24}$/);
  assert.match(sent[0].item?.content?.[0].text ?? '', /Custom HTML widgets omitted/);
  assert.equal(sent[1].item?.type, 'function_call_output'); assert.equal(sent[2].type, 'response.create');
  const again = await context.readForTool({ scope: 'selection', includeImage: true });
  assert.equal(again.image.status, 'rate-limited'); assert.equal(captures, 1);
});

test('stopping the voice listener suppresses a pending raster and failed exports retain structured context', async () => {
  let active = true, resolve: (value: CanvasStill) => void = () => {};
  const sent: unknown[] = [];
  const provider: CanvasContextProvider = { read: () => view, capture: () => new Promise(done => { resolve = done; }) };
  const context = createCanvasContextSender({ current: () => active, provider: () => provider, send: value => sent.push(value) });
  const pending = context.readForTool({ scope: 'selection', includeImage: true }); active = false; resolve(still);
  assert.equal((await pending).image.status, 'cancelled'); assert.equal(sent.length, 0);
  const failed = createCanvasContextSender({ current: () => true, provider: () => ({ read: () => view, capture: async () => { throw new Error('tainted export'); } }), send: value => sent.push(value) });
  const result = await failed.readForTool({ includeImage: true });
  assert.equal(result.image.status, 'unavailable'); assert.equal(result.view?.pageId, view.pageId); assert.equal(sent.length, 0);
});

test('selected photos provide cropped pixels even when the backend omits includeImage', async () => {
  const sent: Sent[] = []; let capturedScope = '';
  const photoView = { ...view, shapes: [{ ...view.shapes[0], type: 'image' }] };
  const context = createCanvasContextSender({ current: () => true, provider: () => ({ read: () => photoView, capture: async scope => { capturedScope = scope; return still; } }), send: event => sent.push(event as Sent) });
  const result = await context.readForTool({ scope: 'viewport', includeImage: false });
  assert.equal(capturedScope, 'selection');
  assert.equal(result.image.status, 'provided');
  assert.equal(sent[0].item?.content?.[1].type, 'input_image');
});
