import type { Page } from '@playwright/test';

type JourneyEvent = {
  eventType: string;
  source?: string;
  tool?: string;
  durationMs?: number;
  payload?: Record<string, unknown>;
};

export async function logJourneyEvent(runId: string, roomName: string, event: JourneyEvent) {
  await fetch('http://localhost:3000/api/journey/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, roomName, events: [event] }),
  });
}

export async function logJourneyAsset(
  runId: string,
  roomName: string,
  assetPath: string,
  label: string,
) {
  await logJourneyEvent(runId, roomName, {
    eventType: 'asset',
    source: 'playwright',
    payload: { path: assetPath, label },
  });
}

export async function attachRunId(page: Page, runId: string) {
  await page.addInitScript((id: string) => {
    window.localStorage.setItem('present:journey-run-id', id);
  }, runId);
}
