import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAssetHandler } from '../server/asset-routes';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lQAAAABJRU5ErkJggg==', 'base64');
async function fixture(options: Parameters<typeof createAssetHandler>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'present-assets-'));
  const handler = createAssetHandler({ directory, ...options });
  const server: Server = createServer((req, res) => { void handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  return { directory, base: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true });
  } };
}

test('uploaded assets round-trip outside the room document and deduplicate by content', async () => {
  const f = await fixture();
  try {
    const upload = () => fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    const response = await upload(); assert.equal(response.status, 201);
    const { src } = await response.json() as { src: string };
    assert.match(src, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
    assert.deepEqual((await (await upload()).json()), { src });
    assert.equal(readdirSync(f.directory).length, 1);
    assert.deepEqual(readFileSync(join(f.directory, src.split('/').pop() ?? '')), png);
    const image = await fetch(`${f.base}${src}`);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(image.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const head = await fetch(`${f.base}${src}`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(png.length)); assert.equal(await head.text(), '');
  } finally { await f.close(); }
});

test('video byte ranges support playback and reject unsatisfiable requests', async () => {
  const f = await fixture();
  try {
    const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom0000isommp42')]);
    const upload = await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: video });
    assert.equal(upload.status, 201); const { src } = await upload.json() as { src: string };
    const partial = await fetch(`${f.base}${src}`, { headers: { range: 'bytes=4-7' } });
    assert.equal(partial.status, 206); assert.equal(await partial.text(), 'ftyp');
    assert.equal(partial.headers.get('content-range'), `bytes 4-7/${video.length}`);
    const suffix = await fetch(`${f.base}${src}`, { headers: { range: 'bytes=-4' } });
    assert.equal(await suffix.text(), 'mp42');
    for (const range of ['bytes=999-1000', 'bytes=5-2', 'bytes=0-1,3-4', 'bytes=-0']) {
      const response = await fetch(`${f.base}${src}`, { headers: { range } });
      assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), `bytes */${video.length}`);
    }
  } finally { await f.close(); }
});

test('asset uploads reject spoofed content, oversized files, cross-origin writes and path escapes', async () => {
  const f = await fixture({ maxBytes: 100 });
  try {
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
      assert.equal((await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': type }, body: '<svg onload="alert(1)" />' })).status, 415);
    }
    assert.equal((await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<html>not a png</html>' })).status, 415);
    assert.equal((await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(101) })).status, 413);
    assert.equal((await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: 'https://elsewhere.example' }, body: png })).status, 403);
    assert.equal((await fetch(`${f.base}/api/assets/%2e%2e%2fprivate.json`)).status, 404);
    assert.equal(readdirSync(f.directory).length, 0);
    const secret = join(f.directory, 'secret'); writeFileSync(secret, 'private');
    const link = `${'a'.repeat(64)}.png`; symlinkSync(secret, join(f.directory, link));
    assert.equal((await fetch(`${f.base}/api/assets/${link}`)).status, 404);
  } finally { await f.close(); }
});

test('chunked uploads enforce the body cap and storage capacity retains existing files', async () => {
  const f = await fixture({ maxBytes: 100, maxFiles: 1 });
  try {
    const status = await new Promise<number>(resolve => {
      const upload = request(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' } }, response => { response.resume(); resolve(response.statusCode ?? 0); });
      upload.write(png); upload.end(Buffer.alloc(100));
    });
    assert.equal(status, 413);
    assert.equal((await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).status, 201);
    const second = Buffer.concat([png, Buffer.from([1])]);
    assert.equal((await fetch(`${f.base}/api/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: second })).status, 507);
    assert.equal(readdirSync(f.directory).length, 1);
  } finally { await f.close(); }
});

test('tldraw asset resolver only exposes accepted local asset paths', async () => {
  const { presentAssetStore } = await import('../src/tldraw/asset-store');
  const resolve = presentAssetStore.resolve;
  assert.ok(resolve);
  type Asset = Parameters<NonNullable<typeof resolve>>[0];
  type Context = Parameters<NonNullable<typeof resolve>>[1];
  const resolveSource = (src: string) => resolve({ type: 'image', props: { src } } as Asset, {} as Context);
  const local = `/api/assets/${'b'.repeat(64)}.png`;
  assert.equal(resolveSource(local), local);
  for (const source of ['https://elsewhere.example/private.png', '//elsewhere.example/image.png', 'data:text/html,<script>alert(1)</script>', '/api/assets/../private', `${local}?redirect=https://elsewhere.example`]) assert.equal(resolveSource(source), null);
});
