#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RoomServiceClient } from 'livekit-server-sdk';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';

loadEnv({ path: path.join(process.cwd(), '.env.local') });

type ScenarioId = 'poster' | 'pen' | 'layout';

type ScenarioConfig = {
  id: ScenarioId;
  label: string;
  description: string;
  userPrompt: string;
};

const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  poster: {
    id: 'poster',
    label: 'Brutalist poster',
    description:
      'Hero poster with title, supporting cards, and sticky-note callouts (Smoke Test 1 baseline).',
    userPrompt:
      'Design a brutalist concert poster for a synthwave night. Use a hero title, supporting blocks, and an energetic composition. Include at least three sticky notes with copy variations.',
  },
  pen: {
    id: 'pen',
    label: 'Pen stroke exploration',
    description: 'Loose exploratory pen strokes with an enclosing circle (maps to Smoke Test 2).',
    userPrompt:
      'On a blank TLDraw canvas, draw three expressive pen strokes forming an “L” shape, then scribble a loose circle around the center to highlight the focal point. Avoid text or shapes; keep it purely pen marks.',
  },
  layout: {
    id: 'layout',
    label: 'Hero plus cards layout',
    description: 'Hero block with three supporting cards aligned using stack/align/distribute.',
    userPrompt:
      'Create a hero card on the left and three supporting cards to its right. After placing them, align and distribute the cards so spacing is even, and ensure nothing overlaps the hero.',
  },
};

const scenarioIds = Object.keys(SCENARIOS) as ScenarioId[];

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || null;
const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

const PARITY_OWNER_EMAIL = process.env.CANVAS_PARITY_OWNER_EMAIL || 'parity-worker@present.local';
let cachedParityOwnerId: string | null = null;

const requireSupabaseAdmin = () => {
  if (!supabaseAdmin) {
    throw new Error(
      '[canvas-parity] Supabase admin credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.',
    );
  }
  return supabaseAdmin;
};

const blankCanvasSnapshot = () => ({
  schemaVersion: 1,
  store: {},
  pages: {},
  assets: {},
  components: {},
});

async function ensureParityOwnerUserId(client: SupabaseClient): Promise<string | null> {
  if (cachedParityOwnerId) return cachedParityOwnerId;
  const adminApi: any = (client as any)?.auth?.admin;
  if (!adminApi || typeof adminApi.createUser !== 'function') {
    console.warn('[canvas-parity] auth.admin unavailable; creating canvases without an owner.');
    return null;
  }

  const getter = typeof adminApi.getUserByEmail === 'function' ? adminApi.getUserByEmail : null;
  if (getter) {
    const { data, error } = await getter.call(adminApi, PARITY_OWNER_EMAIL);
    if (!error && data?.user?.id) {
      cachedParityOwnerId = data.user.id;
      return data.user.id;
    }
    if (error && error.message && !/user not found/i.test(error.message)) {
      console.warn('[canvas-parity] getUserByEmail failed; proceeding without owner', { message: error.message });
    }
  }

  const password = crypto.randomBytes(18).toString('base64url');
  const { data: created, error: createErr } = await adminApi.createUser({
    email: PARITY_OWNER_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { role: 'canvas-parity' },
  });
  if (createErr || !created?.user?.id) {
    console.warn('[canvas-parity] createUser failed; proceeding without owner', {
      message: createErr?.message,
    });
    return null;
  }
  cachedParityOwnerId = created.user.id;
  console.log(`[canvas-parity] created parity owner account for ${PARITY_OWNER_EMAIL}`);
  return created.user.id;
}

async function ensureParityCanvas(options: { scenario: ScenarioConfig; mode: Mode; timestamp: string }) {
  const client = requireSupabaseAdmin();
  const label = `parity-${options.scenario.id}-${options.mode}-${options.timestamp}`;
  const now = new Date().toISOString();
  const { data: existing, error } = await client
    .from('canvases')
    .select('id')
    .eq('name', label)
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  let canvasId = existing?.id as string | undefined;

  if (!canvasId) {
    const ownerId = await ensureParityOwnerUserId(client);
    const { data: inserted, error: insertErr } = await client
      .from('canvases')
      .insert({
        user_id: ownerId,
        name: label,
        description: `Canvas parity sandbox (${options.scenario.label} / ${options.mode}).`,
        document: blankCanvasSnapshot(),
        conversation_key: null,
        is_public: false,
        last_modified: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (insertErr || !inserted?.id) {
      throw insertErr || new Error('Failed to create parity canvas row');
    }
    canvasId = inserted.id;
    console.log(`[canvas-parity] created canvas ${canvasId} (${label})`);
  } else {
    await client
      .from('canvases')
      .update({
        document: blankCanvasSnapshot(),
        description: `Canvas parity sandbox (${options.scenario.label} / ${options.mode}).`,
        name: label,
        last_modified: now,
        updated_at: now,
      })
      .eq('id', canvasId);
  }

  return {
    canvasId,
    canvasName: label,
    roomId: `canvas-${canvasId}`,
  };
}

const resolveScenario = (maybeId: string | undefined): ScenarioConfig => {
  if (!maybeId) return SCENARIOS.poster;
  const normalized = maybeId.trim().toLowerCase() as ScenarioId;
  if (scenarioIds.includes(normalized)) {
    return SCENARIOS[normalized];
  }
  console.warn(`[canvas-parity] Unknown scenario "${maybeId}"; defaulting to poster.`);
  return SCENARIOS.poster;
};

type Mode = 'present' | 'tldraw-teacher' | 'shadow';

type ModeArg = Mode | 'all';

type CliArgs = {
  scenario: string;
  message?: string;
  mode: ModeArg;
  timestamp?: string;
  waitForClient?: boolean;
};

const parseArgs = (): CliArgs => {
  const result: CliArgs = { scenario: 'poster', mode: 'all' };
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
    } else if (arg.startsWith('--timestamp=')) {
      const provided = arg.slice('--timestamp='.length).trim();
      if (provided) {
        result.timestamp = provided;
      }
    } else if (arg === '--wait-for-client') {
      result.waitForClient = true;
    }
  }
  return result;
};

type LoggedActions = { seq: number; partial: boolean; source: 'present' | 'teacher'; actions: unknown[] };

async function runScenario(mode: Mode, roomId: string, message: string) {
  const actionsLog: LoggedActions[] = [];
  process.env.CANVAS_AGENT_MODE = mode;
  await ensureLiveKitRoom(roomId);
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

function resolveLiveKitRestUrl(): string | null {
  const raw =
    process.env.LIVEKIT_REST_URL || process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || process.env.LIVEKIT_HOST;
  if (!raw) return null;
  let url = raw.trim();
  if (url.startsWith('wss://')) url = `https://${url.slice(6)}`;
  if (url.startsWith('ws://')) url = `http://${url.slice(5)}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
  return url.replace(/\/+$/, '');
}

async function ensureLiveKitRoom(roomId: string) {
  const restUrl = resolveLiveKitRestUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!restUrl || !apiKey || !apiSecret) {
    console.warn('[canvas-parity] LiveKit credentials missing; room creation skipped');
    return;
  }
  const client = new RoomServiceClient(restUrl, apiKey, apiSecret);
  const existing = await client.listRooms([roomId]);
  if (existing?.some((room) => room?.name === roomId)) {
    return;
  }
  await client.createRoom({
    name: roomId,
    emptyTimeout: 600,
    maxParticipants: 4,
  });
  console.log(`[canvas-parity] created LiveKit room ${roomId}`);
}

const sanitizeTimestamp = (raw?: string) => {
  if (!raw) return null;
  return raw.replace(/[:.]/g, '-');
};

const waitForClientReady = async () => {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdout.write('[canvas-parity] waiting for client attachment. Press Enter to continue... ');
    process.stdin.once('data', () => {
      process.stdout.write('\n');
      process.stdin.pause();
      resolve();
    });
  });
};

async function main() {
  const args = parseArgs();
  const scenario = resolveScenario(args.scenario);
  const message = args.message ?? scenario.userPrompt;
  const timestamp = sanitizeTimestamp(args.timestamp) ?? new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.cwd(), 'docs', 'parity');
  await fs.mkdir(outDir, { recursive: true });

  const selectedModes: Mode[] =
    args.mode === 'all'
      ? ['present', 'tldraw-teacher']
      : [args.mode as Mode].filter((mode): mode is Mode => mode === 'present' || mode === 'tldraw-teacher' || mode === 'shadow');

  for (const mode of selectedModes) {
    const { roomId, canvasId, canvasName } = await ensureParityCanvas({ scenario, mode, timestamp });
    const viewerPath = `/canvas?room=${roomId}&id=${canvasId}&parity=1`;
    console.log(
      `Running ${scenario.id} (${scenario.label}) in ${mode} mode (room ${roomId}, canvas ${canvasId}, name ${canvasName})`,
    );
    console.log(`Attach a TLDraw client via ${viewerPath}`);
    if (args.waitForClient) {
      await waitForClientReady();
    }
    const { actionsLog, doc } = await runScenario(mode, roomId, message);
    const suffix = `${scenario.id}-${mode}-${timestamp}`;
    const actionsFile = path.join(outDir, `${suffix}-actions.json`);
    const docFile = path.join(outDir, `${suffix}-doc.json`);
    await fs.writeFile(actionsFile, JSON.stringify(actionsLog, null, 2), 'utf-8');
    const docPayload = { roomId, canvasId, canvasName, ...(doc ?? {}) };
    await fs.writeFile(docFile, JSON.stringify(docPayload, null, 2), 'utf-8');
    console.log(`Saved parity artifacts for ${mode} mode under docs/parity/${suffix}-*.json`);
    const suggestedPng = ['docs', 'parity', `${suffix}.png`].join('/');
    const summary = {
      scenario: scenario.id,
      scenarioLabel: scenario.label,
      scenarioDescription: scenario.description,
      mode,
      roomId,
      canvasId,
      canvasName,
      timestamp,
      message,
      actionsFile: ['docs', 'parity', `${suffix}-actions.json`].join('/'),
      docFile: ['docs', 'parity', `${suffix}-doc.json`].join('/'),
      viewerPath,
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
