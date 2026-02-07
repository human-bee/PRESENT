import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { attachRunId, logJourneyAsset, logJourneyEvent } from './helpers/journey-log';

const waitForComponentShape = async (page: any, componentType: string, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((type: string) => {
      const editor = (window as any).__TLDRAW__?.editor;
      if (!editor) return null;
      const shapes = editor.store.allRecords().filter((r: any) => r.typeName === 'shape');
      for (const shape of shapes) {
        const props = shape.props || {};
        if (props.componentType === type || props.type === type || props.name === type) {
          return shape.id;
        }
      }
      return null;
    }, componentType);
    if (found) return found;
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for component shape ${componentType}`);
};

test.describe('journey multi-user (live)', () => {
  test.skip(!process.env.JOURNEY_LIVE, 'JOURNEY_LIVE=1 required for multi-user live journey');

  test('simulated multi-user transcript drives widgets + logs events', async ({ page }, testInfo) => {
    const runId = `journey-${Date.now()}`;
    const roomName = process.env.JOURNEY_ROOM || `canvas-journey-${Date.now()}`;
    const assetsDir = path.join(process.cwd(), 'docs', 'scrapbooks', 'assets', 'journey-live');
    fs.mkdirSync(assetsDir, { recursive: true });

    await attachRunId(page, runId);
    await logJourneyEvent(runId, roomName, {
      eventType: 'run_start',
      source: 'playwright',
      payload: { roomName },
    });

    await page.goto(`http://localhost:3000/canvas?room=${roomName}&journeyRunId=${runId}&journeyLog=1`);
    await page.waitForLoadState('domcontentloaded');

    execSync(`npx tsx scripts/journey/run-multiuser.ts --room ${roomName} --run ${runId}`, {
      stdio: 'inherit',
    });

    await waitForComponentShape(page, 'DebateScorecard');
    await waitForComponentShape(page, 'InfographicWidget');
    await waitForComponentShape(page, 'MemoryRecallWidget');

    const scorecardShot = path.join(assetsDir, `${runId}-scorecard.png`);
    await page.screenshot({ path: scorecardShot, fullPage: true });
    await logJourneyAsset(runId, roomName, scorecardShot, 'Debate scorecard');

    const infographicShot = path.join(assetsDir, `${runId}-infographic.png`);
    await page.screenshot({ path: infographicShot, fullPage: true });
    await logJourneyAsset(runId, roomName, infographicShot, 'Infographic');

    await logJourneyEvent(runId, roomName, {
      eventType: 'run_end',
      source: 'playwright',
    });

    testInfo.attach('runId', { body: runId, contentType: 'text/plain' });
  });
});
