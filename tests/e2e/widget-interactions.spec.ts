import { randomBytes } from 'node:crypto';
import { expect, test, type FrameLocator } from '@playwright/test';
import { CAPABILITIES } from '../../shared/capabilities';

type Scenario = { title: string; button: string; exercise: (a: FrameLocator, b: FrameLocator) => Promise<void> };
const button = (kind: string) => { const item = CAPABILITIES.find(item => item.kind === kind)!; return `${item.title} ${item.description}`; };
const scenarios: Scenario[] = [
  { title: 'Task board', button: button('kanban'), exercise: async (a, b) => {
    await a.locator('#new-task').fill('Prepare the demo'); await a.locator('#new-owner').fill('Alex');
    await a.locator('#new-owner').press('Enter');
    await expect(b.getByLabel('Task title', { exact: true })).toHaveValue('Prepare the demo');
    await b.getByLabel('Task status', { exact: true }).selectOption('Done');
    await expect(a.getByLabel('Task status', { exact: true })).toHaveValue('Done');
    await b.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(a.locator('.task')).toHaveCount(0);
  } },
  { title: 'Meeting brief', button: button('brief'), exercise: async (a, b) => {
    await a.getByLabel('Meeting summary').fill('A shared demo plan');
    await expect(b.getByLabel('Meeting summary')).toHaveValue('A shared demo plan');
    await b.getByLabel('Meeting summary').fill('A correction from the second participant');
    await expect(a.getByLabel('Meeting summary')).toHaveValue('A correction from the second participant');
    await expect(a.getByLabel('Meeting summary')).toBeFocused();
    await a.getByLabel('Meeting summary').fill('A shared demo plan, with both corrections');
    await expect(b.getByLabel('Meeting summary')).toHaveValue('A shared demo plan, with both corrections');
    await a.getByLabel('New decision', { exact: true }).fill('Keep it simple');
    await a.getByLabel('New decision', { exact: true }).press('Enter');
    await expect(b.getByLabel('Decision text')).toHaveValue('Keep it simple');
    await b.getByLabel('New action', { exact: true }).fill('Send the agenda');
    await b.getByLabel('New action owner').fill('River'); await b.getByRole('button', { name: 'Add action', exact: true }).click();
    await expect(a.getByLabel('Action owner', { exact: true })).toHaveValue('River');
    await a.getByLabel('Action status').selectOption('Doing');
    await expect(b.getByLabel('Action status')).toHaveValue('Doing');
  } },
  { title: 'Audience Q&A', button: button('audience'), exercise: async (a, b) => {
    await a.getByLabel('New audience question').fill('What should we try next?');
    await a.getByRole('button', { name: 'Add question', exact: true }).click();
    await b.getByRole('button', { name: 'Vote · 0', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Vote · 1', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(b.locator('#active-question')).toContainText('What should we try next?');
    await b.getByRole('button', { name: 'Resolve active question', exact: true }).click();
    await a.getByLabel('Question filter').selectOption('resolved');
    await expect(a.getByLabel('Question text')).toHaveValue('What should we try next?');
    await a.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(b.getByLabel('Question text')).toHaveValue('What should we try next?');
  } },
  { title: 'Shared deck', button: button('cards'), exercise: async (a, b) => {
    await a.getByRole('button', { name: 'Draw card', exact: true }).click();
    await b.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Return', exact: true }).click();
    await expect(b.locator('#count')).toHaveText('52 in deck');
    await b.getByRole('button', { name: 'Shuffle deck', exact: true }).click();
    await expect(a.locator('#count')).toHaveText('52 in deck');
  } },
  { title: 'Debate desk', button: button('debate'), exercise: async (a, b) => {
    await a.getByText('Add claims & score', { exact: true }).click();
    await a.locator('#new-claim').fill('Synthetic QA claim');
    await a.getByRole('button', { name: 'Add claim', exact: true }).click();
    await expect(b.locator('#claims')).toContainText('Synthetic QA claim');
    await b.getByLabel('Evidence status').selectOption('disputed');
    await expect(a.getByLabel('Evidence status')).toHaveValue('disputed');
    await a.getByRole('button', { name: 'Delete claim', exact: true }).click();
    await expect(b.locator('[data-claim-id]')).toHaveCount(0);
  } },
  { title: 'Find your words', button: 'A voice Find your flow', exercise: async (a, b) => {
    await a.getByRole('button', { name: 'Edit', exact: true }).click();
    await a.getByLabel('Teleprompter script').fill('Welcome to our shared canvas.');
    await a.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(b.locator('#script')).toHaveText('Welcome to our shared canvas.');
    await b.getByRole('button', { name: 'Begin', exact: true }).click();
    await a.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Begin', exact: true })).toBeVisible();
  } },
  { title: 'A shared frequency', button: 'A sound Play together', exercise: async (a, b) => {
    await a.getByRole('button', { name: 'Triangle', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Triangle', exact: true })).toHaveClass('active');
    await b.getByLabel('Pitch', { exact: true }).press('End');
    await expect(a.locator('#frequency')).toHaveText('880');
    // This verifies local playback controls, not physical speaker output.
    await b.getByRole('button', { name: 'Sound on', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Sound off', exact: true })).toBeVisible();
    await expect(a.getByRole('button', { name: 'Sound on', exact: true })).toBeVisible();
    await b.getByRole('button', { name: 'Sound off', exact: true }).click();
  } },
];

for (const scenario of scenarios) test(`${scenario.title} works through two people's real controls`, async ({ browser, baseURL }) => {
  const roomId = randomBytes(16).toString('hex');
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  try {
    await Promise.all(pages.map(page => page.goto(`/r/${roomId}`)));
    for (const page of pages) await expect(page.locator('.room-status')).toHaveText('here, together');
    await pages[0].getByRole('button', { name: 'Add to room', exact: true }).click();
    await pages[0].getByRole('button', { name: scenario.button, exact: true }).click();
    await expect.poll(async () => {
      const widget = await pages[0].locator('.tl-shape').boundingBox();
      const composer = await pages[0].locator('.composer').boundingBox();
      return !!widget && !!composer && widget.y >= 120 && widget.y + widget.height < composer.y;
    }, { message: 'New instrument controls must sit above the composer and dock' }).toBe(true);
    const frames = pages.map(page => page.frameLocator(`iframe[title="${scenario.title}"]`));
    await scenario.exercise(frames[0], frames[1]);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('a tall new instrument stays clear of mobile room controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/r/${randomBytes(16).toString('hex')}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  await page.getByRole('button', { name: 'Add to room', exact: true }).click();
  await page.getByRole('button', { name: button('debate'), exact: true }).click();
  const widget = await page.locator('.tl-shape').boundingBox();
  const composer = await page.locator('.composer').boundingBox();
  expect(widget).not.toBeNull(); expect(composer).not.toBeNull();
  expect(widget!.x).toBeGreaterThanOrEqual(0);
  expect(widget!.x + widget!.width).toBeLessThanOrEqual(390);
  expect(widget!.y).toBeGreaterThanOrEqual(120);
  expect(widget!.y + widget!.height).toBeLessThan(composer!.y);
  const frame = page.frameLocator('iframe[title="Debate desk"]');
  await frame.getByText('Add claims & score', { exact: true }).click();
  await frame.locator('#new-claim').fill('A reachable mobile claim');
  await frame.getByRole('button', { name: 'Add claim', exact: true }).click();
  await expect(frame.locator('[data-claim-id]')).toHaveCount(1);
  await frame.getByRole('button', { name: 'Delete claim', exact: true }).click();
  await expect(frame.locator('[data-claim-id]')).toHaveCount(0);
  await expect(page.locator('.popover')).toHaveCount(0);
});

test('typing in one widget does not rebuild an unchanged task board', async ({ browser, baseURL }) => {
  const roomId = randomBytes(16).toString('hex');
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  try {
    await Promise.all(pages.map(page => page.goto(`/r/${roomId}`)));
    for (const page of pages) await expect(page.locator('.room-status')).toHaveText('here, together');
    for (const kind of ['kanban', 'document']) {
      await pages[0].getByRole('button', { name: 'Add to room', exact: true }).click();
      await pages[0].getByRole('button', { name: button(kind), exact: true }).click();
    }
    const boards = pages.map(page => page.frameLocator('iframe[title="Task board"]'));
    const documents = pages.map(page => page.frameLocator('iframe[title="Shared document"]'));
    for (const board of boards) await expect(board.locator('#board .panel')).toHaveCount(3);
    for (const page of pages) await expect(page.locator('iframe[title="Task board"]')).toHaveAttribute('data-present-rendered-receipts', /\[/);
    // Hold actual DOM nodes, not app state. Receipt-only renders used to destroy them.
    const panels = await Promise.all(boards.map(board => board.locator('#board .panel').first().elementHandle()));
    const input = documents[0].getByRole('textbox', { name: 'Document Markdown' });
    await input.fill('Keep existing widgets responsive.');
    await input.pressSequentially(' No unrelated rebuilds.', { delay: 12 });
    await expect(documents[1].getByRole('textbox', { name: 'Document Markdown' })).toHaveValue('Keep existing widgets responsive. No unrelated rebuilds.');
    for (const panel of panels) expect(await panel?.evaluate(node => node.isConnected)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
