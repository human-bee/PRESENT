#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';

type Scenario = {
  name: string;
  message: string;
};

const SCENARIOS: Record<string, Scenario> = {
  poster: {
    name: 'poster',
    message:
      'Design a brutalist concert poster for a synthwave night. Use a hero title, supporting blocks, and an energetic composition. Include at least three sticky notes with copy variations.',
  },
};

type Mode = 'present' | 'tldraw-teacher' | 'shadow';

type ModeArg = Mode | 'all';

const parseArgs = () => {
  const result: { scenario: string; message?: string; mode: ModeArg } = { scenario: 'poster', mode: 'all' };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--scenario=')) {
      result.scenario = arg.split('=')[1] ?? result.scenario;
    } else if (arg.startsWith('--message=')) {
      result.message = arg.slice('--message='.length);
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length) as ModeArg;
      if (value === 'present' || value === 'tldraw-teacher' || value === 'shadow' || value === 'all') {
        result.mode = value;
      }
    }
  }
  return result;
};

type LoggedActions = { seq: number; partial: boolean; source: 'present' | 'teacher'; actions: unknown[] };

async function runScenario(mode: Mode, roomId: string, message: string) {
  const actionsLog: LoggedActions[] = [];
  process.env.CANVAS_AGENT_MODE = mode;
  await runCanvasAgent({
    roomId,
    userMessage: message,
    hooks: {
      onActions: ({ seq, partial, source, actions }) => {
        actionsLog.push({ seq, partial, source, actions });
      },
    },
  });
  const doc = await getCanvasShapeSummary(roomId);
  return { actionsLog, doc };
}

const layoutVerbs = ['align', 'distribute', 'stack', 'reorder'];

const summarizeActions = (log: LoggedActions[], source: 'present' | 'teacher') => {
  const verbs: Record<string, number> = {};
  for (const entry of log) {
    if (entry.source !== source) continue;
    for (const action of entry.actions as any[]) {
      const name = typeof action?.name === 'string' ? action.name : 'unknown';
      verbs[name] = (verbs[name] ?? 0) + 1;
    }
  }
  const total = Object.values(verbs).reduce((sum, count) => sum + count, 0);
  const layoutUsage: Record<string, number> = {};
  for (const verb of layoutVerbs) {
    layoutUsage[verb] = verbs[verb] ?? 0;
  }
  return {
    totalActions: total,
    verbs,
    uniqueVerbs: Object.keys(verbs).length,
    layoutUsage,
  };
};

const buildShadowMetrics = (log: LoggedActions[]) => {
  const present = summarizeActions(log, 'present');
  const teacher = summarizeActions(log, 'teacher');
  const deltas: Record<string, number> = {};
  for (const verb of layoutVerbs) {
    deltas[verb] = (teacher.layoutUsage[verb] ?? 0) - (present.layoutUsage[verb] ?? 0);
  }
  return {
    present,
    teacher,
    delta: {
      totalActions: teacher.totalActions - present.totalActions,
      layout: deltas,
    },
  };
};

async function main() {
  const args = parseArgs();
  const scenario = SCENARIOS[args.scenario] ?? SCENARIOS.poster;
  const message = args.message ?? scenario.message;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseRoom = `parity-${scenario.name}-${timestamp}`;
  const outDir = path.resolve(process.cwd(), 'docs', 'parity');
  await fs.mkdir(outDir, { recursive: true });

  const selectedModes: Mode[] =
    args.mode === 'all'
      ? ['present', 'tldraw-teacher']
      : [args.mode as Mode].filter((mode): mode is Mode => mode === 'present' || mode === 'tldraw-teacher' || mode === 'shadow');

  for (const mode of selectedModes) {
    const roomId = `${baseRoom}-${mode}`;
    console.log(`Running ${scenario.name} in ${mode} mode (room ${roomId})`);
    const { actionsLog, doc } = await runScenario(mode, roomId, message);
    const suffix = `${scenario.name}-${mode}-${timestamp}`;
    const actionsFile = path.join(outDir, `${suffix}-actions.json`);
    const docFile = path.join(outDir, `${suffix}-doc.json`);
    await fs.writeFile(actionsFile, JSON.stringify(actionsLog, null, 2), 'utf-8');
    await fs.writeFile(docFile, JSON.stringify(doc, null, 2), 'utf-8');
    console.log(`Saved parity artifacts for ${mode} mode under docs/parity/${suffix}-*.json`);
    const suggestedPng = ['docs', 'parity', `${suffix}.png`].join('/');
    const summary = {
      scenario: scenario.name,
      mode,
      roomId,
      timestamp,
      message,
      actionsFile: ['docs', 'parity', `${suffix}-actions.json`].join('/'),
      docFile: ['docs', 'parity', `${suffix}-doc.json`].join('/'),
      suggestedPng,
    };
    await fs.writeFile(path.join(outDir, `${suffix}-summary.json`), JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`Suggested PNG capture for ${mode}: ${suggestedPng}`);
    if (mode === 'shadow') {
      const metrics = buildShadowMetrics(actionsLog);
      await fs.writeFile(path.join(outDir, `${suffix}-metrics.json`), JSON.stringify(metrics, null, 2), 'utf-8');
      console.log('Shadow metrics summary:', JSON.stringify(metrics, null, 2));
      console.log(
        `Quick diff → present actions: ${metrics.present.totalActions}, teacher actions: ${metrics.teacher.totalActions}`,
      );
      console.log('Layout deltas (teacher - present):', metrics.delta.layout);
    }
  }
}

main().catch((error) => {
  console.error('[canvas-parity] failed', error);
  process.exit(1);
});
