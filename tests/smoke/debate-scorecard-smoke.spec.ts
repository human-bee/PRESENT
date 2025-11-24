import { test, expect, Page } from '@playwright/test';

const TEST_TIMEOUT = 240_000; // generous window for live agent

type ScorecardProps = {
  version: number | null;
  claims: unknown[];
  componentId?: string;
};

async function waitForScorecardUpdate(
  page: Page,
  options: { quoteContains?: string } = {},
): Promise<ScorecardProps> {
  const { quoteContains } = options;
  return await page.evaluate((expected) => {
    return new Promise<{ version: number | null; claims: unknown[]; componentId?: string }>((resolve) => {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent)?.detail;
        const component = detail?.component;
        if (!component || component.type !== 'DebateScorecard') {
          return;
        }
        const props = component.props ?? {};
        if (expected?.quoteContains) {
          const claims = Array.isArray(props.claims) ? props.claims : [];
          const match = claims.some((claim: any) =>
            typeof claim?.quote === 'string' && claim.quote.includes(expected.quoteContains),
          );
          if (!match) {
            return;
          }
        }
        window.removeEventListener('custom:showComponent', handler);
        clearTimeout(timeoutId);
        resolve({
          version:
            typeof props.version === 'number'
              ? props.version
              : typeof props._version === 'number'
                ? props._version
                : null,
          claims: Array.isArray(props.claims) ? props.claims : [],
          componentId: typeof props.componentId === 'string' ? props.componentId : undefined,
        });
      };
      window.addEventListener('custom:showComponent', handler);
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener('custom:showComponent', handler);
        resolve({ version: null, claims: [], componentId: undefined });
      }, 210000);
    });
  }, { quoteContains } as { quoteContains?: string | null });
}

async function sendMessage(page, text: string) {
  const input = page.getByPlaceholder('Type a message for the agent…');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await input.fill(text);
  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await input.focus();
  await input.press('Enter');
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return;
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (button && !button.disabled) {
      button.click();
    }
  });
  await expect(input).toHaveValue('', { timeout: 5_000 });
}

function canvasUrl() {
  const id = `e2e-${Date.now()}`;
  return `http://localhost:3000/canvas?id=${id}`;
}

test.describe('Debate scorecard steward smoke test', () => {
  test('scorecard updates reflect steward broadcasts', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);
    page.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log('[browser]', msg.type(), msg.text());
    });
    page.setDefaultTimeout(TEST_TIMEOUT);

  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(canvasUrl(), { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    (window as any).__presentDispatcherMetrics = true;
    (window as any).__toolMetrics = [];
    window.addEventListener('present:tool_metrics', (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const store = (window as any).__toolMetrics as unknown[];
      store.push(detail);
    });
    (window as any).__componentEvents = [];
    window.addEventListener('custom:showComponent', (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const log = (window as any).__componentEvents as unknown[];
      log.push(detail);
    });
    (window as any).__transcriptEvents = [];
    window.addEventListener('custom:transcription-local', (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const log = (window as any).__transcriptEvents as unknown[];
      log.push(detail);
    });
  });

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
    await expect(page.getByText('Sends as “you” over LiveKit to the voice agent.')).toBeVisible({ timeout: 60_000 });
    const initialScorecardPromise = waitForScorecardUpdate(page);
    await sendMessage(
      page,
      "Let's start a debate on whether remote work boosts productivity. Please create the scorecard.",
    );
    const initialScorecard = await initialScorecardPromise;
    expect(initialScorecard.claims.length).toBe(0);

    const affirmativeScorecardPromise = waitForScorecardUpdate(page, {
      quoteContains: 'Remote work boosts productivity because employees can focus better at home',
    });
    await sendMessage(
      page,
      'Affirmative argument: Remote work boosts productivity because employees can focus better at home.',
    );
    const affirmativeScorecard = await affirmativeScorecardPromise;
    expect(
      affirmativeScorecard.claims.some(
        (claim: any) =>
          typeof claim?.quote === 'string' &&
          claim.quote.includes('Remote work boosts productivity because employees can focus better at home'),
      ),
    ).toBeTruthy();

    const negativeScorecardPromise = waitForScorecardUpdate(page, {
      quoteContains: 'Remote work hurts collaboration and slows innovation',
    });
    await sendMessage(
      page,
      'Negative argument: Remote work hurts collaboration and slows innovation.',
    );
    const negativeScorecard = await negativeScorecardPromise;
    expect(
      negativeScorecard.claims.some(
        (claim: any) =>
          typeof claim?.quote === 'string' &&
          claim.quote.includes('Remote work hurts collaboration and slows innovation'),
      ),
    ).toBeTruthy();

    const metricsLog = await page.evaluate(() => (window as any).__toolMetrics as { tool?: string }[]);
    expect(metricsLog.some((entry) => entry?.tool === 'update_component')).toBeTruthy();
    const transcriptLog = await page.evaluate(() => (window as any).__transcriptEvents as { text?: string }[]);
    expect(
      transcriptLog.some((payload) =>
        typeof payload?.text === 'string' &&
        payload.text.includes('Remote work boosts productivity because employees can focus better at home'),
      ),
    ).toBeTruthy();
  });
});
