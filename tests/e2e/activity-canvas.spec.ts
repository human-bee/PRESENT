import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { RoomObject } from '../../shared/room';

test('activity widgets avoid overlap and share edits with their focused view', async ({ page }, info) => {
  const roomId = randomBytes(16).toString('hex');
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('.room-status')).toHaveText('here, together');
  for (const kind of ['Debate', 'Standup']) {
    await page.getByRole('button', { name: '◈ Activities', exact: true }).click();
    await page.locator('.activity-template-grid button').filter({ has: page.getByText(kind, { exact: true }) }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Back to canvas ↙', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.native-canvas .room-activity')).toHaveCount(2);
  const read = async (): Promise<RoomObject[]> => (await (await page.request.get(`/api/room/${roomId}`)).json()).room.objects;
  const activities = (await read()).filter(o => o.data.capability === 'activity-stage');
  expect(activities).toHaveLength(2);
  const [a, b] = activities;
  expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  const debate = activities.find(o => o.title === 'A good disagreement');
  if (!debate) throw new Error('The Debate widget was not saved.');
  await page.goto(`/r/${roomId}?focus=${debate.id}`);
  const card = page.locator('.native-canvas .room-activity-debate');
  await card.getByRole('button', { name: 'Room memory', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'How we got here', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'The floor', exact: true }).click();
  await card.getByRole('button', { name: 'Adapt activity', exact: true }).click();
  await card.getByLabel('Room topic', { exact: true }).fill('Edited on the canvas');
  await card.getByLabel('Follow the conversation', { exact: true }).uncheck();
  await card.getByRole('button', { name: 'Save adaptation', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Edited on the canvas', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Make active', exact: true }).click();
  await page.getByRole('button', { name: 'Open Debate', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Edited on the canvas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to canvas ↙', exact: true }).click();
  await page.getByRole('button', { name: 'Fit everything', exact: true }).click();
  await page.screenshot({ path: info.outputPath('separate-activity-widgets.png') });
  expect((await read()).filter(o => o.data.capability === 'activity-stage')).toHaveLength(2);
});
