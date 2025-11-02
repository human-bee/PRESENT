import { test, expect } from '@playwright/test';

const TEST_TIMEOUT = 240_000; // generous window for live agent

async function sendMessage(page, text: string) {
  const input = page.getByPlaceholder('Type a message for the agent…');
  await input.fill(text);
  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await sendButton.click();
  await expect(sendButton).toBeDisabled({ timeout: 5_000 });
  await expect(sendButton).toBeEnabled({ timeout: 60_000 });
}

function canvasUrl() {
  const id = `e2e-${Date.now()}`;
  return `http://localhost:3000/canvas?id=${id}`;
}

test.describe('Debate scorecard steward smoke test', () => {
  test('scorecard updates reflect steward broadcasts', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.goto(canvasUrl(), { waitUntil: 'networkidle' });

    const connectLocator = page.getByRole('button', { name: 'Connect' });
    await expect(connectLocator).toBeEnabled({ timeout: 20_000 });
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const target = buttons.find((btn) => btn.textContent?.includes('Connect'));
      target?.click();
    });
    await expect(page.getByText('Connected')).toBeVisible({ timeout: 20_000 });

    const requestLocator = page.getByRole('button', { name: 'Request agent' });
    await expect(requestLocator).toBeEnabled({ timeout: 20_000 });
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const target = buttons.find((btn) => btn.textContent?.includes('Request agent'));
      target?.click();
    });
    await sendMessage(
      page,
      "Let's start a debate on whether remote work boosts productivity. Please create the scorecard.",
    );

    await expect(page.getByText('DEBATE ANALYSIS')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('No claims captured yet.')).toBeVisible({ timeout: 20_000 });

    await sendMessage(
      page,
      'Affirmative argument: Remote work boosts productivity because employees can focus better at home.',
    );

    await expect(page.getByText('No claims captured yet.')).toBeHidden({ timeout: 90_000 });
    await expect(
      page.getByText('Remote work boosts productivity because employees can focus better at home', {
        exact: false,
      }),
    ).toBeVisible({ timeout: 90_000 });

    await sendMessage(
      page,
      'Negative argument: Remote work hurts collaboration and slows innovation.',
    );

    await expect(
      page.getByText('Negative argument: Remote work hurts collaboration and slows innovation', {
        exact: false,
      }),
    ).toBeVisible({ timeout: 90_000 });
  });
});
