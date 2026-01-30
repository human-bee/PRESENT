type JourneyEventInput = {
  eventType: string;
  source?: string;
  tool?: string;
  durationMs?: number;
  payload?: Record<string, unknown>;
  assetPath?: string;
};

type JourneyLoggerConfig = {
  runId: string;
  roomName?: string;
  endpoint: string;
  enabled: boolean;
  secret?: string;
};

const GLOBAL_KEY = '__present_journey_logger__';
const MAX_BATCH = 30;
const FLUSH_INTERVAL_MS = 250;

type JourneyLoggerState = {
  config: JourneyLoggerConfig | null;
  queue: JourneyEventInput[];
  flushTimer: number | null;
};

const getState = (): JourneyLoggerState => {
  const root = globalThis as any;
  if (!root[GLOBAL_KEY]) {
    root[GLOBAL_KEY] = {
      config: null,
      queue: [],
      flushTimer: null,
    } satisfies JourneyLoggerState;
  }
  return root[GLOBAL_KEY] as JourneyLoggerState;
};

const scheduleFlush = () => {
  const state = getState();
  if (state.flushTimer !== null) return;
  state.flushTimer = window.setTimeout(() => {
    state.flushTimer = null;
    void flushJourneyEvents();
  }, FLUSH_INTERVAL_MS);
};

const flushJourneyEvents = async () => {
  const state = getState();
  if (!state.config?.enabled || !state.config.runId) return;
  if (state.queue.length === 0) return;
  const batch = state.queue.splice(0, state.queue.length);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (state.config.secret) {
      headers['x-journey-secret'] = state.config.secret;
    }
    await fetch(state.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        runId: state.config.runId,
        roomName: state.config.roomName,
        events: batch,
      }),
      keepalive: true,
    });
  } catch {
    state.queue.unshift(...batch);
  }
};

export function initJourneyLogger(config: JourneyLoggerConfig) {
  if (typeof window === 'undefined') return;
  const state = getState();
  state.config = config;
  state.queue = [];
  if (config.enabled) {
    logJourneyEvent({
      eventType: 'run_start',
      source: 'ui',
      payload: { runId: config.runId, roomName: config.roomName },
    });
  }
}

export function updateJourneyRoom(roomName: string) {
  if (typeof window === 'undefined') return;
  const state = getState();
  if (!state.config) return;
  state.config = { ...state.config, roomName };
}

export function logJourneyEvent(event: JourneyEventInput) {
  if (typeof window === 'undefined') return;
  const state = getState();
  if (!state.config?.enabled || !state.config.runId) return;
  state.queue.push(event);
  if (state.queue.length >= MAX_BATCH) {
    void flushJourneyEvents();
    return;
  }
  scheduleFlush();
}

export function resolveJourneyConfig() {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const runParam = url.searchParams.get('journeyRunId') || url.searchParams.get('journey');
    const enabledParam = url.searchParams.get('journeyLog') || url.searchParams.get('journey');
    const storedRunId = window.localStorage.getItem('present:journey-run-id');
    const runId = runParam && runParam.length > 0 ? runParam : storedRunId || '';
    const enabled =
      (enabledParam && enabledParam !== '0' && enabledParam !== 'false') ||
      process.env.NEXT_PUBLIC_JOURNEY_LOGGING === 'true';

    return {
      runId: runId || (enabled ? crypto.randomUUID() : ''),
      enabled: Boolean(enabled),
    };
  } catch {
    return null;
  }
}

export function persistJourneyRunId(runId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('present:journey-run-id', runId);
  } catch { }
}
