import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'Devtools123!';

async function signUpAndConnect(page: any) {
  const email = `debate+${Date.now()}_${Math.random().toString(36).slice(2, 6)}@present.local`;
  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.getByLabel('Name').fill('Playwright Debater');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/canvas**', { timeout: 20_000 });
  await page.waitForTimeout(2_000);

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.waitForTimeout(500);
  const connectButton = page.getByRole('button', { name: 'Connect' });
  await connectButton.scrollIntoViewIfNeeded();
  await connectButton.click();
  await page.getByRole('button', { name: 'Disconnect' }).waitFor({ timeout: 20_000 });
  const requestButton = page.getByRole('button', { name: 'Request agent' }).first();
  await requestButton.click();
  await page.waitForTimeout(3_000);

  return email;
}

async function sendTranscriptLine(page: any, text: string) {
  const input = page.locator('form input[type="text"]').first();
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(3_000);
}

async function ensureTranscriptVisible(page: any) {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.waitForTimeout(300);
}

async function triggerScorecard(page: any) {
  await ensureTranscriptVisible(page);
  await sendTranscriptLine(page, 'Please start a debate analysis scorecard for school uniforms.');
  await page.waitForTimeout(4_000);
}

async function verifyScorecardAppears(page: any) {
  await page.waitForTimeout(3000);
  await expect(page.getByText('Debate Analysis', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ledger' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Judge RFD' })).toBeVisible();
}

async function driveDebate(page: any) {
  const lines = [
    'Aff constructive: uniforms reduce bullying by removing clothing competition.',
    'Neg response: studies show no significant bullying reduction after uniforms.',
    'Aff rebuttal: uniforms improve attendance and discipline indirectly.',
    'Neg rebuttal: uniforms cost families hundreds and are inequitable.',
  ];
  for (const line of lines) {
    await sendTranscriptLine(page, line);
  }
  await page.waitForTimeout(5_000);
}

async function verifyLedgerAndMap(page: any) {
  const ledgerRows = page.locator('table tbody tr');
  await expect(ledgerRows.first()).toBeVisible();
  await expect(ledgerRows.nth(1)).toBeVisible();
  await page.getByRole('button', { name: 'Map' }).click();
  await page.waitForTimeout(1_000);
  const fallbackMessage = page.getByText('Argument map is empty').first();
  await expect(fallbackMessage).not.toBeVisible();
}

async function verifyJudgeRFDAccess(page: any) {
  await page.getByRole('button', { name: 'Judge RFD' }).click();
  await page.waitForTimeout(1_000);
  await expect(page.getByText('Reason For Decision')).toBeVisible();
}

test.describe('Debate scorecard steward flow', () => {
  test('voice agent builds a debate analysis workspace from typed prompts', async ({ page }) => {
    await signUpAndConnect(page);
    await triggerScorecard(page);
    await verifyScorecardAppears(page);
    await driveDebate(page);
    await verifyLedgerAndMap(page);
    await verifyJudgeRFDAccess(page);
  });
});
