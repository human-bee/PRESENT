#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { defaultCapabilities } from '../src/lib/agents/capabilities';
import { buildVoiceAgentInstructions } from '../src/lib/agents/instructions';
import {
  buildToolEvent,
  flushPendingToolCallQueue,
  normalizeComponentPatch,
  shouldSuppressCanvasDispatch,
  type PendingToolCallEntry,
} from '../src/lib/agents/realtime/voice-agent/tool-publishing';
import { VoiceComponentLedger } from '../src/lib/agents/realtime/voice-agent/component-ledger';

type Summary = {
  iterations: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
};

type RacetrackResult = {
  benchmark: 'voice-agent-racetrack';
  recordedAt: string;
  commit: {
    hash: string;
    branch: string;
    dirty: boolean;
  };
  env: {
    node: string;
    platform: string;
  };
  metrics: {
    instructionBuild: Summary & { chars: number };
    patchNormalize: Summary;
    canvasDispatch: Summary & { suppressRatePct: number };
    ledgerOps: Summary;
    queueFlush: Summary;
  };
};

const OUT_DIR = path.join(process.cwd(), 'docs/benchmarks/racetrack');
const LATEST_PATH = path.join(OUT_DIR, 'latest.json');
const HISTORY_PATH = path.join(OUT_DIR, 'history.jsonl');

const nowMs = () => Number(process.hrtime.bigint()) / 1_000_000;

const toSummary = (iterations: number, totalMs: number): Summary => {
  const safeTotal = totalMs <= 0 ? 0.0001 : totalMs;
  return {
    iterations,
    totalMs: Number(totalMs.toFixed(3)),
    avgMs: Number((safeTotal / iterations).toFixed(6)),
    opsPerSec: Number(((iterations / safeTotal) * 1000).toFixed(2)),
  };
};

const runSyncBenchmark = (iterations: number, fn: () => void): Summary => {
  const start = nowMs();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  return toSummary(iterations, nowMs() - start);
};

const getGitValue = (command: string, fallback = 'unknown') => {
  try {
    const value = execSync(command, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return value || fallback;
  } catch {
    return fallback;
  }
};

const runLedgerBenchmark = (iterations: number): Summary => {
  const room = 'racetrack-room';
  const ledger = new VoiceComponentLedger(() => room);
  const context = {
    getComponentEntry: (id: string) => {
      if (!id.startsWith('ui-')) return undefined;
      return { type: 'CrowdPulseWidget', room };
    },
    listComponentEntries: function* () {
      for (let i = 0; i < 32; i += 1) {
        yield [`ui-seed-${i}`, { type: 'CrowdPulseWidget', room }] as const;
      }
    },
    roomKey: room,
  };

  const start = nowMs();
  for (let i = 0; i < iterations; i += 1) {
    const intentId = `intent-${i}`;
    const messageId = `ui-${i}`;
    const slot = `slot-${i % 7}`;
    ledger.registerIntentEntry({
      intentId,
      messageId,
      componentType: 'CrowdPulseWidget',
      slot,
      state: 'updated',
    });
    ledger.setLastComponentForType('CrowdPulseWidget', messageId);
    ledger.resolveComponentId({ intentId }, context);
    ledger.resolveComponentId({ slot }, context);
    ledger.clearIntentForMessage(messageId);
  }
  return toSummary(iterations, nowMs() - start);
};

const runQueueFlushBenchmark = async (iterations: number): Promise<Summary> => {
  const start = nowMs();
  for (let i = 0; i < iterations; i += 1) {
    const queue: PendingToolCallEntry[] = [];
    for (let j = 0; j < 16; j += 1) {
      queue.push({
        event: buildToolEvent('update_component', { componentId: `ui-${j}`, patch: { isRunning: true } }, 'race-room'),
        reliable: true,
      });
    }
    await flushPendingToolCallQueue({
      queue,
      isConnected: true,
      publish: async () => true,
    });
  }
  return toSummary(iterations, nowMs() - start);
};

const main = async () => {
  const args = new Set(process.argv.slice(2));
  const noRecord = args.has('--no-record');

  const baselineInstructions = buildVoiceAgentInstructions(
    defaultCapabilities,
    defaultCapabilities.components || [],
  );

  const instructionBuild = {
    ...runSyncBenchmark(400, () => {
      buildVoiceAgentInstructions(defaultCapabilities, defaultCapabilities.components || []);
    }),
    chars: baselineInstructions.length,
  };

  const patchNormalize = runSyncBenchmark(4000, () => {
    normalizeComponentPatch(
      {
        duration: '7m',
        running: 'true',
        update: { minutes: 4, seconds: 15 },
        command: 'reset',
      },
      300,
    );
  });

  const dispatchMap = new Map<string, { ts: number; requestId?: string }>();
  let suppressed = 0;
  const dispatchSummary = runSyncBenchmark(5000, () => {
    const requestId = Math.random() > 0.5 ? 'request-1' : `request-${Math.floor(Math.random() * 1000)}`;
    const shouldSuppress = shouldSuppressCanvasDispatch({
      dispatches: dispatchMap,
      roomName: 'race-room',
      message: 'draw a cat',
      requestId,
    });
    if (shouldSuppress) suppressed += 1;
  });

  const ledgerOps = runLedgerBenchmark(5000);
  const queueFlush = await runQueueFlushBenchmark(250);

  const result: RacetrackResult = {
    benchmark: 'voice-agent-racetrack',
    recordedAt: new Date().toISOString(),
    commit: {
      hash: getGitValue('git rev-parse --short HEAD'),
      branch: getGitValue('git branch --show-current'),
      dirty: getGitValue('git status --porcelain') !== '',
    },
    env: {
      node: process.version,
      platform: process.platform,
    },
    metrics: {
      instructionBuild,
      patchNormalize,
      canvasDispatch: {
        ...dispatchSummary,
        suppressRatePct: Number(((suppressed / dispatchSummary.iterations) * 100).toFixed(2)),
      },
      ledgerOps,
      queueFlush,
    },
  };

  if (!noRecord) {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.writeFile(LATEST_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await fs.appendFile(HISTORY_PATH, `${JSON.stringify(result)}\n`, 'utf8');
  }

  console.log(JSON.stringify(result, null, 2));
  if (!noRecord) {
    console.log(`\n[racetrack] wrote ${LATEST_PATH}`);
    console.log(`[racetrack] appended ${HISTORY_PATH}`);
  }
};

main().catch((error) => {
  console.error('[racetrack] benchmark failed', error);
  process.exitCode = 1;
});
