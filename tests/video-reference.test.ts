import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeObject } from '../shared/room';
import { makeVideoObject, MAX_VIDEO_START_SECONDS, parseVideoURL, readVideoReference, videoWrapperPath, youtubeEmbedURL } from '../shared/video-reference';
import { createEmbedHandler } from '../server/embed-routes';
import { RoomStore } from '../server/room-store';
import { YouTubeVideo } from '../src/widgets/youtube-video';

const videoId = 'M7lc1UVf-VE';
const roomId = 'e'.repeat(24);

test('YouTube references retain only the canonical video and requested start timestamp', () => {
  for (const url of [`https://www.youtube.com/watch?v=${videoId}&t=90&si=tracking`, `https://youtu.be/${videoId}?t=1m30s`, `youtube.com/shorts/${videoId}?start=90`, `https://m.youtube.com/watch?v=${videoId}#t=90`, `https://youtube.com/embed/${videoId}?start=90&autoplay=1`]) {
    assert.deepEqual(parseVideoURL(url), { videoId, startSeconds: 90 });
  }
  assert.deepEqual(parseVideoURL(`https://youtu.be/${videoId}?t=1h2m3s`), { videoId, startSeconds: 3723 });
  assert.deepEqual(parseVideoURL(`https://youtube.com/watch?v=${videoId}`), { videoId, startSeconds: 0 });
  assert.equal(new URL(youtubeEmbedURL({ videoId, startSeconds: 0 }) ?? '').searchParams.has('start'), false);
  const src = new URL(youtubeEmbedURL({ videoId, startSeconds: 90 }) ?? '');
  assert.equal(src.origin, 'https://www.youtube-nocookie.com');
  assert.equal(src.pathname, `/embed/${videoId}`);
  assert.equal(src.searchParams.get('autoplay'), '0');
  assert.equal(src.searchParams.get('controls'), '1');
  assert.equal(src.searchParams.get('start'), '90');
  assert.equal(src.searchParams.has('enablejsapi'), false);
});

test('video references reject arbitrary hosts, credential URLs, ambiguous IDs and invalid timestamps', () => {
  for (const url of [
    `https://youtube.com.evil.example/watch?v=${videoId}`, `https://evil.example/?v=${videoId}`,
    `https://youtube.com@127.0.0.1/watch?v=${videoId}`, `https://user:secret@youtube.com/watch?v=${videoId}`,
    `https://youtube.com:8080/watch?v=${videoId}`, `file:///watch?v=${videoId}`, 'javascript:alert(1)',
    `https://youtube.com/redirect?q=https://127.0.0.1&v=${videoId}`, `https://youtu.be/${videoId}/extra`,
    `https://youtube.com/watch?v=${videoId}&v=ABCDEFGHIJK`, `https://youtube.com/watch?v=${videoId}&t=30&start=60`,
    ...['-1', 'NaN', 'Infinity', '1.5', '', `${MAX_VIDEO_START_SECONDS + 1}`].map(time => `https://youtu.be/${videoId}?t=${time}`),
  ]) assert.equal(parseVideoURL(url), null, url);
  assert.throws(() => makeVideoObject('https://elsewhere.example/video', 'alice', { x: 0, y: 0 }));
  for (const data of [{ capability: 'widget', videoId }, { capability: 'youtube', videoId: '../private' }, { capability: 'youtube', videoId, startSeconds: '90' }, { capability: 'youtube', videoId, startSeconds: Infinity }]) assert.equal(readVideoReference(data), null);
});

test('wrapper references cannot escape their room/object path and stay stable through canvas gestures', () => {
  const object = makeVideoObject(`https://youtu.be/${videoId}?t=90`, 'alice', { x: 10, y: 20 });
  const path = videoWrapperPath(roomId, object.id);
  assert.equal(path, `/embed/${roomId}/${object.id}`);
  assert.equal(videoWrapperPath(roomId, 'shape:example'), `/embed/${roomId}/shape%3Aexample`);
  for (const id of ['..', '../private', '/absolute', 'id?src=evil', '%2e%2e', 'id#fragment']) assert.equal(videoWrapperPath(roomId, id), null);
  assert.equal(videoWrapperPath('../room', object.id), null);
  const markup = renderToStaticMarkup(createElement(YouTubeVideo, { object, roomId }));
  const moved = renderToStaticMarkup(createElement(YouTubeVideo, { object: { ...object, x: 100, y: 200, w: 800, h: 500 }, roomId }));
  assert.equal(markup, moved);
  assert.match(markup, /Loading video/);
  assert.doesNotMatch(markup, /<iframe/);
  assert.doesNotMatch(markup, /youtube-nocookie|srcdoc|allow-autoplay/);

});

test('the native canvas persists the YouTube reference after movement, resize and store reload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'present-video-native-'));
  let store = new RoomStore({ directory });
  try {
    const object = makeVideoObject(`https://youtu.be/${videoId}?t=90`, 'alice', { x: 0, y: 0 });
    store.applyOperation(roomId, { type: 'put', object }, 'alice');
    store.applyOperation(roomId, { type: 'patch', id: object.id, patch: { x: 120, y: 80, w: 640, h: 400 } }, 'bob');
    store.close(); store = new RoomStore({ directory });
    const restored = store.getRoom(roomId).objects.find(item => item.id === object.id);
    assert.ok(restored);
    assert.deepEqual(restored.data, { capability: 'youtube', videoId, startSeconds: 90 });
    assert.deepEqual([restored.x, restored.y, restored.w, restored.h], [120, 80, 640, 400]);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'present-video-route-'));
  const store = new RoomStore({ directory });
  const object = makeVideoObject(`https://youtu.be/${videoId}?t=90`, 'alice', { x: 0, y: 0 });
  object.title = '</title><script>unsafe()</script>';
  store.applyOperation(roomId, { type: 'put', object }, 'alice');
  const handler = createEmbedHandler(id => store.getRoom(id));
  const server = createServer((req, res) => { if (!handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  return { store, object, base: `http://127.0.0.1:${address.port}`, path: videoWrapperPath(roomId, object.id) ?? '', close: async () => {
    await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(directory, { recursive: true, force: true });
  } };
}

test('embed route reads canonical native data, ignores query input and applies a scoped CSP', async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.base}${f.path}?src=http://127.0.0.1/private&videoId=ABCDEFGHIJK&start=999`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`src="https://www.youtube-nocookie.com/embed/${videoId}\\?autoplay=0&amp;controls=1&amp;playsinline=1&amp;start=90&amp;enablejsapi=1"`));
    assert.doesNotMatch(html, /unsafe|127\.0\.0\.1|ABCDEFGHIJK|start=999/);
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-src https:\/\/www\.youtube-nocookie\.com;/);
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'sha256-/);
    assert.match(html, /iframe_api/);
    assert.match(html, /present:video-command/);
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    const head = await fetch(`${f.base}${f.path}`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(html)));
    f.store.applyOperation(roomId, { type: 'patch', id: f.object.id, patch: { data: { startSeconds: 120 } } }, 'alice');
    assert.match(await (await fetch(`${f.base}${f.path}`)).text(), /start=120/);
  } finally { await f.close(); }
});

test('embed route rejects missing/invalid objects, foreign origins, opaque frames and path escapes', async () => {
  const f = await fixture();
  try {
    const note = makeObject('note', 'alice', { x: 0, y: 0 });
    f.store.applyOperation(roomId, { type: 'put', object: note }, 'alice');
    for (const path of [`/embed/${roomId}/missing`, `/embed/${roomId}/${note.id}`, `/embed/${roomId}/%2e%2e%2fprivate`, `/embed/${roomId}/%252e%252e`, `/embed/${roomId}/bad%ZZ`]) assert.equal((await fetch(`${f.base}${path}`)).status, 404);
    const blockedHeaders: Record<string, string>[] = [{ Origin: 'https://elsewhere.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' }];
    for (const headers of blockedHeaders) assert.equal((await fetch(`${f.base}${f.path}`, { headers })).status, 403);
    assert.equal((await fetch(`${f.base}${f.path}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    assert.equal((await fetch(`${f.base}${f.path}`, { method: 'POST' })).status, 405);
    const hostileHost = await new Promise<number>(resolve => request(`${f.base}${f.path}`, { headers: { Host: 'elsewhere.example' } }, res => { res.resume(); resolve(res.statusCode ?? 0); }).end());
    assert.equal(hostileHost, 403);
    f.store.applyOperation(roomId, { type: 'patch', id: f.object.id, patch: { data: { videoId: '../private' } } }, 'alice');
    assert.equal((await fetch(`${f.base}${f.path}`)).status, 404);
  } finally { await f.close(); }
});
