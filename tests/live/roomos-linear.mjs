import dotenv from 'dotenv';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
if (process.env.PRESENT_LIVE_ROOMOS !== '1') throw new Error('Explicit live RoomOS opt-in required. Reads the configured Linear viewer.');
dotenv.config({ path: process.env.PRESENT_ENV_FILE ?? '.env.local', quiet: true });
if (!process.env.LINEAR_API_KEY) throw new Error('Linear is not configured.');
const response = await fetch('https://api.linear.app/graphql', { method: 'POST', headers: { Authorization: process.env.LINEAR_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query { viewer { id name } }' }), signal: AbortSignal.timeout(20000) });
const raw = await response.json(); if (!response.ok || raw.errors?.length || !raw.data?.viewer) throw new Error('The configured Linear viewer is unavailable.');
const viewer = raw.data.viewer, roomId = randomBytes(16).toString('hex'); await mkdir('.data/qa', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }), context = await browser.newContext({ baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 1000 } });
try {
  await context.addInitScript(name => localStorage.setItem('present:name', name), viewer.name); const page = await context.newPage();
  await page.goto(`http://127.0.0.1:4318/r/${roomId}`); await expect(page.locator('.room-status')).toHaveText('here, together'); await page.getByRole('button', { name: '◈ Activities', exact: true }).click(); await page.locator('.activity-template-grid button').filter({ has: page.getByText('Standup', { exact: true }) }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Join the standup' }).click(); await dialog.getByRole('button', { name: 'Update my profile' }).click(); await dialog.getByLabel('Linear member UUID').fill(viewer.id); await dialog.getByRole('button', { name: 'Read from Linear', exact: true }).click();
  await expect(dialog.locator('.member-card')).toContainText('Read from Linear · work labels are not skill ratings', { timeout: 25000 });
  const os = await (await page.request.get(`/api/activity/state?roomId=${roomId}`)).json(), profile = os.activities[0].meeting.members[0];
  expect(profile.status).toBe('ready'); expect(profile.linearId).toBe(viewer.id); expect(profile.team.length).toBeGreaterThan(0); expect(profile.projects.length).toBeGreaterThan(0);
  await expect(dialog.locator('.member-card')).toContainText(profile.team); for (const project of profile.projects) await expect(dialog.locator('.member-card')).toContainText(project);
  await dialog.getByRole('button', { name: 'Update my profile' }).click(); await page.screenshot({ path: '.data/qa/linear-profile.png' });
  await page.reload(); await page.getByRole('dialog').locator('.member-card').getByText(profile.name, { exact: true }).waitFor();
  const proof = { status: 'passed', at: new Date().toISOString(), roomId, viewerIdHash: createHash('sha256').update(viewer.id).digest('hex'), teamPresent: Boolean(profile.team), projects: profile.projects.length, observedWorkLabels: profile.strengths.length, source: 'Actual authenticated Linear viewer through the RoomOS UI', screenshot: 'Private local .data/qa/linear-profile.png', boundary: 'No membership changes, invitations or messages. Visibility to this account does not prove a new teammate has access.' };
  await writeFile('docs/evidence/roomos-final/linear-ui.json', JSON.stringify(proof, null, 2)); console.log(proof);
} finally { await context.close(); await browser.close(); }
