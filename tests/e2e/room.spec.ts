import { randomBytes } from 'node:crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Editor } from 'tldraw';
import type { RoomObject } from '../../shared/room';

const shape = (page: Page, id: string) => page.locator(`.tl-shape[data-shape-id="shape:${id}"]`);
const note = (page: Page) => page.locator('.tl-note__container');
async function objects(page: Page, room: string): Promise<RoomObject[]> {
  return (await page.request.get(`/api/room/${room}`).then(response => response.json())).room.objects;
}
async function geometry(page: Page, id: string) {
  return page.evaluate(id => {
    const item = (window as unknown as Window & { __presentEditor: Editor }).__presentEditor.getShape(`shape:${id}` as never);
    return item ? { x: item.x, y: item.y, props: item.props } : null;
  }, id);
}
async function drag(page: Page, target: Locator, dx: number, dy: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing native shape drag target');
  const x = box.x + Math.min(80, box.width / 2), y = box.y + Math.min(24, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}
async function fitCanvas(page: Page) {
  await page.getByRole('button', { name: 'Fit everything' }).click();
  let previous = '', stable = 0;
  await expect.poll(async () => {
    const current = await page.evaluate(() => JSON.stringify((window as unknown as { __presentEditor: Editor }).__presentEditor.getCamera()));
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    return stable;
  }, { intervals: [80, 100, 150] }).toBeGreaterThanOrEqual(2);
}

async function editNote(page: Page, text: string) {
  await note(page).dblclick({ position: { x: 90, y: 80 } });
  await note(page).locator('[contenteditable="true"]').fill(text);
  await page.keyboard.press('Escape');
  await expect(note(page).locator('.tl-text-content')).toContainText(text);
}

test('two people natively edit, drag, resize, undo, time, roll, and reload the same room', async ({ browser, baseURL }, info) => {
  const room = randomBytes(16).toString('hex');
  const a = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const b = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await a.addInitScript(() => localStorage.setItem('present:name', 'Alex'));
  await b.addInitScript(() => localStorage.setItem('present:name', 'River'));
  const [alex, river] = await Promise.all([a.newPage(), b.newPage()]);
  try {
    await Promise.all([alex.goto(`/r/${room}`), river.goto(`/r/${room}`)]);
    await expect(alex.locator('.room-status')).toHaveText('here, together');
    await expect(alex.locator('.person-name', { hasText: 'River' })).toBeVisible();
    await alex.getByRole('button', { name: 'Leave a thought' }).click();
    await editNote(alex, 'A room for people and their ideas.');
    await expect(note(river).locator('.tl-text-content')).toContainText('A room for people and their ideas.');
    const sentence = 'A room for people, agents, and their ideas.';
    await editNote(river, sentence);
    await expect(note(alex).locator('.tl-text-content')).toContainText(sentence);
    const thought = (await objects(alex, room)).find(object => object.kind === 'note');
    if (!thought) throw new Error('Native note was not persisted');
    const original = await geometry(alex, thought.id);
    await drag(alex, note(alex), -330, -100);
    await expect.poll(async () => (await geometry(alex, thought.id))?.x).not.toBe(original?.x);
    const moved = await geometry(alex, thought.id);
    await expect.poll(() => geometry(river, thought.id)).toEqual(moved);
    await alex.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => geometry(alex, thought.id)).toEqual(original);
    await expect.poll(() => geometry(river, thought.id)).toEqual(original);
    await alex.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => geometry(river, thought.id)).toEqual(moved);
    await expect(note(alex).locator('.tl-text-content')).toContainText(sentence);

    await alex.getByRole('button', { name: 'Add to room', exact: true }).click();
    await alex.getByRole('button', { name: 'A moment A shared timer' }).click();
    await alex.getByLabel('Timer duration').selectOption('60000');
    await alex.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(river.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect.poll(() => river.getByRole('timer').textContent()).not.toBe('1:00');
    await river.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(alex.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    const paused = await river.getByRole('timer').innerText();
    await expect(alex.getByRole('timer')).toHaveText(paused);
    const timer = (await objects(alex, room)).find(object => object.kind === 'timer');
    if (!timer) throw new Error('Timer was not persisted');
    const timerShape = shape(alex, timer.id);
    await drag(alex, timerShape.locator('[title="Drag to move"]'), 270, -120);
    const beforeResize = await geometry(alex, timer.id);
    if (!beforeResize) throw new Error('Timer disappeared before resize');
    const originalSize = beforeResize.props as { w: number; h: number };
    const box = await timerShape.boundingBox();
    if (!box) throw new Error('Missing native timer bounds');
    // Drag the actual native selection corner; the editor is only read for proof.
    await alex.mouse.move(box.x + box.width, box.y + box.height);
    await alex.mouse.down();
    await alex.mouse.move(box.x + box.width + 90, box.y + box.height + 65, { steps: 12 });
    await alex.mouse.up();
    await expect.poll(async () => ((await geometry(alex, timer.id))?.props as { w: number } | undefined)?.w).toBeGreaterThan(originalSize.w);
    await expect.poll(async () => ((await geometry(alex, timer.id))?.props as { h: number } | undefined)?.h).toBeGreaterThan(originalSize.h);
    const resized = await geometry(alex, timer.id);
    await expect.poll(() => geometry(river, timer.id)).toEqual(resized);
    await expect(alex.getByRole('timer')).toHaveText(paused);

    await alex.getByRole('button', { name: 'Add to room', exact: true }).click();
    await alex.getByRole('button', { name: 'Dice table Roll common dice with a shared, attributed history.' }).click();
    const diceA = alex.frameLocator('iframe[title="Dice table"]');
    const diceB = river.frameLocator('iframe[title="Dice table"]');
    await diceA.getByLabel('Number of dice').selectOption('2');
    await diceA.getByLabel('Dice sides').selectOption('20');
    await diceA.getByRole('button', { name: 'Roll dice', exact: true }).click();
    await expect(diceA.locator('#latest output')).toBeVisible();
    const rolled = await diceA.locator('#latest output').innerText();
    expect(Number(rolled)).toBeGreaterThanOrEqual(2);
    expect(Number(rolled)).toBeLessThanOrEqual(40);
    await expect(diceB.locator('#latest output')).toHaveText(rolled);
    await diceB.getByRole('button', { name: 'Roll dice', exact: true }).click();
    await diceA.getByText('Shared roll history', { exact: true }).click();
    await expect(diceA.locator('#history > div')).toHaveCount(2);
    const dice = (await objects(alex, room)).find(object => object.data.capability === 'dice');
    if (!dice) throw new Error('Dice table was not persisted');
    const rolls = Object.entries(dice.data.state as Record<string, { values: number[]; actor: string }>).filter(([key]) => key.startsWith('roll:')).map(([, value]) => value);
    expect(rolls).toHaveLength(2);
    expect(new Set(rolls.map(roll => roll.actor)).size).toBe(2);
    await drag(alex, shape(alex, dice.id).locator('[title="Drag to move"]'), -80, 160);
    await fitCanvas(alex);
    await alex.screenshot({ path: info.outputPath('native-desktop-1440x900.png') });

    await Promise.all([alex.reload(), river.reload()]);
    await expect(note(alex).locator('.tl-text-content')).toContainText(sentence);
    await expect.poll(() => geometry(river, thought.id)).toEqual(moved);
    await expect.poll(() => geometry(river, timer.id)).toEqual(resized);
    await expect(alex.getByRole('timer')).toHaveText(paused);
    await expect(river.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    await alex.frameLocator('iframe[title="Dice table"]').getByText('Shared roll history', { exact: true }).click();
    await expect(alex.frameLocator('iframe[title="Dice table"]').locator('#history > div')).toHaveCount(2);
    await alex.setViewportSize({ width: 390, height: 844 });
    await fitCanvas(alex);
    await expect(alex.getByRole('textbox', { name: 'Ask the room' })).toBeVisible();
    await expect(alex.getByRole('button', { name: 'Turn microphone on' })).toBeVisible();
    await alex.screenshot({ path: info.outputPath('native-mobile-390x844.png') });
    const final = await objects(alex, room);
    expect(final).toHaveLength(3);
    expect(final.find(object => object.kind === 'timer')?.data.endsAt).toBeNull();
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('native rich text keeps every character while prior server acknowledgements arrive late', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const room = randomBytes(16).toString('hex');
  try {
    await page.routeWebSocket('**/connect?*', socket => {
      const server = socket.connectToServer();
      server.onMessage(message => { setTimeout(() => socket.send(message), 120); });
    });
    await page.goto(`/r/${room}`);
    await expect(page.locator('.room-status')).toHaveText('here, together');
    await page.getByRole('button', { name: 'Leave a thought' }).click();
    await note(page).dblclick({ position: { x: 90, y: 80 } });
    const sentence = 'Every character belongs in the shared thought.';
    await note(page).locator('[contenteditable="true"]').pressSequentially(sentence, { delay: 15 });
    await expect(note(page).locator('[contenteditable="true"]')).toHaveText(sentence);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await objects(page, room))[0]?.data.text).toBe(sentence);
    await page.reload();
    await expect(note(page).locator('.tl-text-content')).toContainText(sentence);
  } finally { await context.close(); }
});
