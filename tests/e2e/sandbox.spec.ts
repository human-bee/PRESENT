import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

async function seed(baseURL: string | undefined, room: string, html: string, state: Record<string, unknown>) {
  if (!baseURL) throw new Error('The end-to-end base URL is required');
  const id = randomUUID();
  const response = await fetch(`${baseURL}/api/room/${room}/operation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: 'e2e-fixture', requestId: randomUUID(), operation: { type: 'put', object: {
      id, kind: 'widget', title: 'Sandbox proof', x: 440, y: 220, w: 480, h: 350,
      data: { html, state }, pinned: false, createdBy: 'test', createdAt: Date.now(), expiresAt: null,
    } } }),
  });
  if (!response.ok) throw new Error(`Fixture failed: ${response.status} ${await response.text()}`);
  return id;
}

async function holdStateDelivery(page: Page) {
  const queued: (() => void)[] = [];
  let held = false;
  await page.routeWebSocket('**/connect?*', ws => {
    const server = ws.connectToServer();
    server.onMessage(message => {
      if (held && JSON.parse(message.toString()).type !== 'pong') queued.push(() => ws.send(message));
      else ws.send(message);
    });
  });
  return { hold: () => { held = true; }, release: () => { held = false; for (const send of queued.splice(0)) send(); } };
}

test('different state keys survive concurrent changes from two stale iframe clients', async ({ browser, baseURL }) => {
  const room = randomBytes(16).toString('hex');
  const object = await seed(baseURL, room, `<button id="left" onclick="present.setState({left:1})">Left</button>
    <button id="right" onclick="present.setState({right:1})">Right</button>
    <button onclick="present.increment('score')">Add a point</button><pre id="state"></pre>
    <script>function render(){document.getElementById('state').textContent=JSON.stringify(present.getState())}
    window.addEventListener('present:state',render);render()</script>`, { left: 0, right: 0, untouched: 'keep me' });
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  const [first, second] = await Promise.all([a.newPage(), b.newPage()]);
  try {
    const [gateA, gateB] = await Promise.all([holdStateDelivery(first), holdStateDelivery(second)]);
    await Promise.all([first.goto(`/r/${room}`), second.goto(`/r/${room}`)]);
    const frameA = first.frameLocator('iframe');
    const frameB = second.frameLocator('iframe');
    await expect(frameA.locator('#state')).toContainText('keep me');
    await expect(frameB.locator('#state')).toContainText('keep me');
    gateA.hold(); gateB.hold();
    await frameA.getByRole('button', { name: 'Left', exact: true }).click();
    await frameB.getByRole('button', { name: 'Right', exact: true }).click();
    const read = () => first.request.get(`/api/room/${room}`).then(r => r.json());
    await expect.poll(async () => (await read()).room.objects.find((item: { id: string }) => item.id === object).data.state).toEqual({ left: 1, right: 1, untouched: 'keep me' });
    expect((await read()).room.objects.find((item: { id: string }) => item.id === object).data.state).toEqual({ left: 1, right: 1, untouched: 'keep me' });
    gateA.release(); gateB.release();
    await expect(frameA.locator('#state')).toHaveText('{"left":1,"right":1,"untouched":"keep me"}');
    await expect(frameB.locator('#state')).toHaveText('{"left":1,"right":1,"untouched":"keep me"}');
    gateA.hold(); gateB.hold();
    await frameA.getByRole('button', { name: 'Add a point' }).click();
    await frameB.getByRole('button', { name: 'Add a point' }).click();
    await expect.poll(async () => (await read()).room.objects[0].data.state.score).toBe(2);
    gateA.release(); gateB.release();
    await expect(frameA.locator('#state')).toHaveText('{"left":1,"right":1,"untouched":"keep me","score":2}');
    await expect(frameB.locator('#state')).toHaveText('{"left":1,"right":1,"untouched":"keep me","score":2}');
    await first.reload();
    await expect(first.frameLocator('iframe').locator('#state')).toHaveText('{"left":1,"right":1,"untouched":"keep me","score":2}');
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('generated iframe cannot directly read its parent, send requests, open windows, or navigate the room', async ({ page, baseURL }, info) => {
  const room = randomBytes(16).toString('hex');
  await seed(baseURL, room, `<button id="probe">Probe isolation</button><pre id="result"></pre>
    <a id="link" href="https://sandbox-escape.invalid/link" target="_top">External link</a>
    <form action="https://sandbox-escape.invalid/form"><button>Submit external form</button></form>
    <button id="self">Navigate iframe</button><script>
    document.getElementById('probe').onclick=async()=>{const result={};
      try{result.parent=parent.document.title}catch{result.parent='blocked'}
      try{result.storage=localStorage.length}catch{result.storage='blocked'}
      try{await fetch('https://sandbox-escape.invalid/fetch');result.network='escaped'}catch{result.network='blocked'}
      try{top.location.href='https://sandbox-escape.invalid/top';result.top='escaped'}catch{result.top='blocked'}
      result.popup=window.open('https://sandbox-escape.invalid/popup')?'escaped':'blocked';
      document.getElementById('link').click();
      document.getElementById('result').textContent=JSON.stringify(result)};
    document.getElementById('self').onclick=()=>location.assign('https://sandbox-escape.invalid/self');</script>`, {});
  const externalRequests: string[] = [];
  const popups: string[] = [];
  const browserMessages: string[] = [];
  await page.route('https://sandbox-escape.invalid/**', route => { externalRequests.push(route.request().url()); return route.abort(); });
  page.on('popup', popup => { popups.push(popup.url()); void popup.close(); });
  page.on('console', message => browserMessages.push(message.text()));
  await page.goto(`/r/${room}`);
  const frame = page.frameLocator('iframe');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await frame.getByRole('button', { name: 'Probe isolation' }).click();
  await expect(frame.locator('#result')).toHaveText('{"parent":"blocked","storage":"blocked","network":"blocked","top":"blocked","popup":"blocked"}');
  await frame.getByRole('button', { name: 'Submit external form' }).click();
  await expect(frame.getByRole('button', { name: 'Probe isolation' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('native-sandbox-isolation.png') });
  await frame.getByRole('button', { name: 'Navigate iframe' }).click();
  await expect.poll(() => browserMessages.some(message => message.includes('frame-src') && message.includes('sandbox-escape.invalid'))).toBe(true);
  await expect.poll(() => page.frames()[1]?.url()).not.toContain('sandbox-escape.invalid');
  expect(page.url()).toBe(`${baseURL}/r/${room}`);
  expect(externalRequests).toEqual([]);
  expect(popups).toEqual([]);
});


test('an explicit source-link click opens a separate tab through the parent bridge', async ({ page, context, baseURL }) => {
  const room = randomBytes(16).toString('hex');
  await seed(baseURL, room, '<a href="https://sandbox-source.invalid/source" target="_top">Read the source</a>', {});
  const requests: string[] = [];
  const popups: Page[] = [];
  await context.route('https://sandbox-source.invalid/**', route => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Source fixture</title><p>A routed source fixture.</p>' });
  });
  context.on('page', popup => { if (popup !== page) popups.push(popup); });
  await page.goto(`/r/${room}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.frameLocator('iframe').getByRole('link', { name: 'Read the source' }).click();
  await expect.poll(async () => popups.length + await page.locator('.widget-external-link a').count()).toBe(1);
  // Browsers that do not transfer iframe activation use the visible parent link.
  if (!popups.length) await page.locator('.widget-external-link a').click();
  await expect.poll(() => popups.length).toBe(1);
  await expect(popups[0]).toHaveTitle('Source fixture');
  expect(await popups[0].evaluate(() => ({ opener: window.opener === null, referrer: document.referrer }))).toEqual({ opener: true, referrer: '' });
  expect(requests).toEqual(['https://sandbox-source.invalid/source']);
  expect(page.url()).toBe(`${baseURL}/r/${room}`);
  await expect(page.frameLocator('iframe').getByRole('link', { name: 'Read the source' })).toBeVisible();
  await popups[0].close();
});
