import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('each participant has one shared vote and keeps their choice after reloading', async ({ browser, baseURL }, info) => {
  const room = randomBytes(16).toString('hex');
  const a = await browser.newContext({ baseURL });
  const b = await browser.newContext({ baseURL });
  const events: Record<string, unknown>[] = [];
  for (const [name, context] of [['first', a], ['second', b]] as const) {
    await context.exposeBinding('__pollProof', ({ frame }, data: Record<string, unknown>) => {
      events.push({ client: name, at: Date.now(), frame: frame.url(), ...data });
    });
    await context.addInitScript(() => {
      const record = (data: Record<string, unknown>) => {
        void (window as unknown as { __pollProof: (event: Record<string, unknown>) => Promise<void> }).__pollProof(data);
      };
      window.addEventListener('message', event => {
        if (['present:ready', 'present:patch'].includes(event.data?.type)) record({ type: event.data.type, patch: event.data.patch });
      });
      document.addEventListener('click', event => {
        const button = (event.target as Element).closest?.('button.option');
        if (button) record({ type: 'poll-click', choice: button.textContent, participantId: (window as unknown as { present: { participantId: string } }).present.participantId });
      }, true);
    });
  }
  const [first, second] = await Promise.all([a.newPage(), b.newPage()]);
  let holdStates = false;
  const queuedStates: (() => void)[] = [];
  for (const [name, page] of [['first', first], ['second', second]] as const) {
    await page.routeWebSocket('**/connect?*', socket => {
      const server = socket.connectToServer();
      server.onMessage(message => {
        if (holdStates && JSON.parse(message.toString()).type !== 'pong') queuedStates.push(() => socket.send(message));
        else socket.send(message);
      });
    });
    page.on('request', request => {
      if (!new URL(request.url()).pathname.endsWith('/operation') || request.method() !== 'POST') return;
      const data = request.postDataJSON();
      events.push({ client: name, at: Date.now(), type: 'http-operation', requestId: data.requestId,
        operation: { type: data.operation.type, patch: data.operation.patch } });
    });
  }
  try {
    await Promise.all([first.goto(`/r/${room}`), second.goto(`/r/${room}`)]);
    await expect(first.locator('.person')).toHaveCount(2);
    await first.getByRole('button', { name: 'Add to room', exact: true }).click();
    await first.getByRole('button', { name: 'A question Vote together' }).click();
    await expect(first.locator('.add-menu')).toHaveCount(0);
    const pollA = first.frameLocator('iframe[title="A room pulse"]');
    const pollB = second.frameLocator('iframe[title="A room pulse"]');
    await expect(pollA.locator('.option strong')).toHaveText(['0', '0', '0']);
    await expect(pollB.locator('.option strong')).toHaveText(['0', '0', '0']);
    holdStates = true;
    // One Chrome instance has one hardware pointer. Serialize its clicks while
    // withholding replies so both people still vote against the same stale state.
    await pollA.getByRole('button', { name: /Explore a little/ }).click();
    await pollB.getByRole('button', { name: /Make something/ }).click();
    await expect.poll(async () => {
      const state = (await first.request.get(`/api/room/${room}`).then(response => response.json())).room.objects[0].data.state;
      return Object.entries(state).filter(([key]) => key.startsWith('vote:')).map(([, choice]) => choice).sort();
    }).toEqual([0, 1]);
    holdStates = false;
    for (const send of queuedStates.splice(0)) send();
    await expect(pollA.locator('.option strong')).toHaveText(['1', '1', '0']);
    await expect(pollB.locator('.option strong')).toHaveText(['1', '1', '0']);
    await expect(pollA.getByRole('button', { name: /Explore a little/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(pollB.getByRole('button', { name: /Make something/ })).toHaveAttribute('aria-pressed', 'true');
    await first.reload();
    await expect(first.frameLocator('iframe').getByRole('button', { name: /Explore a little/ })).toHaveAttribute('aria-pressed', 'true');
    await first.frameLocator('iframe').getByRole('button', { name: /Take a breath/ }).click();
    await expect(pollB.locator('.option strong')).toHaveText(['0', '1', '1']);
    await expect(pollB.locator('#total')).toHaveText('2 votes · your choice is saved');
    await expect(first.locator('.person')).toHaveCount(2);
  } finally {
    await info.attach('poll-event-sequence', { body: JSON.stringify({ room, events }, null, 2), contentType: 'application/json' });
    await Promise.all([a.close(), b.close()]);
  }
});
