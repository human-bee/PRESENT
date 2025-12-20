import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
export const DEFAULT_PASSWORD = 'Devtools123!';

export type StepResult = {
  name: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  screenshot?: string;
  notes?: string;
  error?: string;
};

export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export async function signInOrSignUp(
  page: Page,
  options: { email?: string; password?: string },
): Promise<{ email: string; password: string; mode: 'signin' | 'signup' }> {
  const envEmail = (options.email || '').trim();
  const envPassword = (options.password || '').trim();
  const hasEnvCreds = Boolean(envEmail && envPassword);

  const randomEmail = `fairy-lap+${Date.now()}_${Math.random().toString(36).slice(2, 6)}@present.local`;
  const email = hasEnvCreds ? envEmail : randomEmail;
  const password = hasEnvCreds ? envPassword : DEFAULT_PASSWORD;

  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'networkidle' });

  const trySignIn = async () => {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForURL('**/canvas**', { timeout: 45_000 });
  };

  if (hasEnvCreds) {
    try {
      await trySignIn();
      return { email, password, mode: 'signin' };
    } catch {
      // fallback to signup
    }
  }

  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: 'networkidle' });
  await page.getByLabel('Name').fill('Playwright Fairy Lap');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.waitForURL('**/canvas**', { timeout: 60_000 });

  return { email, password, mode: 'signup' };
}

export async function snap(page: Page, imagesDir: string, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(imagesDir, name) });
}

export function writeReport(outputDir: string, runId: string, results: StepResult[]) {
  const reportLines = [
    `# Fairy Lap Report (${runId})`,
    '',
    `- Total duration: ${results.reduce((sum, step) => sum + step.durationMs, 0)} ms`,
    '',
    '| Step | Status | Duration (ms) | Screenshot | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((step) => {
      const screenshot = step.screenshot ? `[${step.screenshot}](./images/${step.screenshot})` : '';
      const notes = step.error ? `❌ ${step.error}` : step.notes || '';
      return `| ${step.name} | ${step.status} | ${step.durationMs} | ${screenshot} | ${notes} |`;
    }),
    '',
  ];

  fs.writeFileSync(path.join(outputDir, 'report.md'), reportLines.join('\n'));
}
