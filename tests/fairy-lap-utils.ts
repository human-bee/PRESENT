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

export type ReportSummary = {
  metrics?: Array<{ label: string; value: string }>;
  artifacts?: Array<{ label: string; path: string }>;
  notes?: string[];
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
    await page.waitForLoadState('networkidle').catch(() => {});
    await page
      .waitForURL('**/canvas**', { timeout: 90_000 })
      .catch(() => page.waitForSelector('[data-canvas-space="true"]', { timeout: 90_000 }));
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
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .waitForURL('**/canvas**', { timeout: 90_000 })
    .catch(() => page.waitForSelector('[data-canvas-space="true"]', { timeout: 90_000 }));

  return { email, password, mode: 'signup' };
}

export async function snap(page: Page, imagesDir: string, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(imagesDir, name), timeout: 30_000 });
}

export function writeReport(outputDir: string, runId: string, results: StepResult[], summary?: ReportSummary) {
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

  if (summary?.metrics?.length) {
    reportLines.push('## Summary Metrics', '', '| Metric | Value |', '| --- | --- |');
    summary.metrics.forEach((metric) => {
      reportLines.push(`| ${metric.label} | ${metric.value} |`);
    });
    reportLines.push('');
  }

  if (summary?.artifacts?.length) {
    reportLines.push('## Artifacts', '', '| Artifact | Path |', '| --- | --- |');
    summary.artifacts.forEach((artifact) => {
      const link = artifact.path ? `[${artifact.path}](${artifact.path})` : '';
      reportLines.push(`| ${artifact.label} | ${link} |`);
    });
    reportLines.push('');
  }

  if (summary?.notes?.length) {
    reportLines.push('## Notes', '');
    summary.notes.forEach((note) => reportLines.push(`- ${note}`));
    reportLines.push('');
  }

  fs.writeFileSync(path.join(outputDir, 'report.md'), reportLines.join('\n'));
}
