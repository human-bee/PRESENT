#!/usr/bin/env tsx
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  FAIRY_CLI_DEFAULT_BASE_URL,
  FAIRY_CLI_EXIT_CODES,
  fairyCliRunEnvelopeSchema,
  fairyCliTaskSchema,
  type FairyCliMutationResult,
  type FairyCliRunEnvelope,
} from '@/lib/agents/shared/fairy-cli-contract';
import {
  getTeacherContractMetadata,
  TEACHER_ACTIONS_BY_PROFILE,
  type TeacherContractProfile,
} from '@/lib/canvas-agent/contract/teacher';
import {
  getFairyParityEntry,
  getFairyParitySummary,
} from '@/lib/canvas-agent/contract/fairy-parity-matrix';
import { getTraceSession, pollTaskStatus, runAdminAction, sendRunAndMaybeWait } from './client';
import {
  createSession,
  getCurrentSession,
  getSessionById,
  loadState,
  saveState,
  upsertSession,
  type FairyCliSession,
  type FairyCliState,
  type FairyCliSubagentRun,
} from './state';

const FAIRY_TASK_SET = new Set<string>(fairyCliTaskSchema.options);

const parseTeacherProfile = (value: string | null): TeacherContractProfile => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'fairy' || normalized === 'fairy48') return 'fairy48';
  if (normalized === 'template' || normalized === 'template24') return 'template24';
  throw new Error('Unsupported --profile value. Use fairy48 or template24.');
};

type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const trimmed = token.slice(2);
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > -1) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      flags[key] = value;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[trimmed] = next;
      i += 1;
      continue;
    }
    flags[trimmed] = true;
  }
  return { positionals, flags };
};

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readFlagString = (flags: ParsedArgs['flags'], ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = flags[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const readFlagBoolean = (flags: ParsedArgs['flags'], key: string, fallback = false): boolean => {
  const value = flags[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const readFlagNumber = (flags: ParsedArgs['flags'], key: string, fallback: number): number => {
  const value = flags[key];
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseJsonFlag = (flags: ParsedArgs['flags'], key = 'args'): Record<string, unknown> => {
  const raw = readFlagString(flags, key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${key} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse --${key} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const formatResult = (value: unknown, asJson: boolean): string => {
  if (asJson) return JSON.stringify(value, null, 2);
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const printResult = (value: unknown, asJson: boolean) => {
  process.stdout.write(`${formatResult(value, asJson)}\n`);
};

const printError = (message: string, asJson: boolean) => {
  if (asJson) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    return;
  }
  process.stderr.write(`Error: ${message}\n`);
};

const exitCodeForMutation = (result: FairyCliMutationResult): number => {
  if (result.status === 'applied') return FAIRY_CLI_EXIT_CODES.APPLIED;
  if (result.status === 'queued') return FAIRY_CLI_EXIT_CODES.QUEUED;
  if (result.status === 'timeout') return FAIRY_CLI_EXIT_CODES.TIMEOUT;
  if (result.status === 'unauthorized' || result.status === 'invalid') {
    return FAIRY_CLI_EXIT_CODES.AUTH_OR_CONFIG;
  }
  return FAIRY_CLI_EXIT_CODES.FAILED;
};

const resolveMessage = (parsed: ParsedArgs, startIndex: number): string | null => {
  const explicit = readFlagString(parsed.flags, 'message', 'text');
  if (explicit) return explicit;
  const parts = parsed.positionals.slice(startIndex).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(' ');
};

const resolveSession = (state: FairyCliState, parsed: ParsedArgs): FairyCliSession => {
  const requestedSessionId = readFlagString(parsed.flags, 'session');
  const requested = getSessionById(state, requestedSessionId ?? undefined);
  if (requested) return requested;
  const current = getCurrentSession(state);
  if (!current) {
    throw new Error('No active CLI session. Run: fairy sessions create --room canvas-... or fairy sessions use <id>');
  }
  return current;
};

const updateSessionWithMutation = (session: FairyCliSession, result: FairyCliMutationResult): FairyCliSession => {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    lastTaskId: result.taskId,
    lastTraceId: result.traceId,
    lastRequestId: result.requestId,
  };
};

const runChildScript = async (cwd: string, scriptPath: string, args: string[]): Promise<number> => {
  const full = path.join(cwd, scriptPath);
  const child = spawn('node', [full, ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  return await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
};

const buildRunEnvelope = (session: FairyCliSession, input: {
  task: string;
  message?: string;
  params?: Record<string, unknown>;
  requestId?: string;
  traceId?: string;
  intentId?: string;
  executionId?: string;
  idempotencyKey?: string;
  lockKey?: string;
  attempt?: number;
  experimentId?: string;
  variantId?: string;
  assignmentNamespace?: string;
  assignmentUnit?: 'room_session';
  assignmentTs?: string;
  factorLevels?: Record<string, string>;
}): FairyCliRunEnvelope => {
  const requestId = input.requestId ?? `cli-${randomUUID()}`;
  const traceId = input.traceId ?? requestId;
  const intentId = input.intentId ?? (input.task === 'fairy.intent' ? requestId : undefined);

  const baseParams: Record<string, unknown> = {
    room: session.room,
    ...(input.params ?? {}),
  };

  if (input.task === 'fairy.intent') {
    baseParams.id = readString(baseParams.id) ?? intentId ?? requestId;
    baseParams.message = readString(baseParams.message) ?? input.message ?? '';
    baseParams.source = readString(baseParams.source) ?? 'cli';
    const metadata = baseParams.metadata && typeof baseParams.metadata === 'object' && !Array.isArray(baseParams.metadata)
      ? ({ ...(baseParams.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
    baseParams.metadata = {
      ...metadata,
      origin: 'fairy-cli',
      channel: 'cli',
      traceId,
      intentId: baseParams.id,
    };
  } else if (input.task === 'canvas.agent_prompt') {
    baseParams.message = readString(baseParams.message) ?? input.message ?? '';
  } else if (input.task === 'canvas.quick_text') {
    const text = readString(baseParams.text) ?? readString(baseParams.message) ?? input.message ?? '';
    baseParams.text = text;
  }

  const envelope: FairyCliRunEnvelope = {
    room: session.room,
    task: input.task,
    requestId,
    traceId,
    intentId,
    executionId: input.executionId,
    idempotencyKey: input.idempotencyKey,
    lockKey: input.lockKey,
    attempt: input.attempt,
    params: baseParams,
    summary: input.message,
    message: input.message,
    experiment_id: input.experimentId,
    variant_id: input.variantId,
    assignment_namespace: input.assignmentNamespace,
    assignment_unit: input.assignmentUnit,
    assignment_ts: input.assignmentTs,
    factor_levels: input.factorLevels,
  };

  return fairyCliRunEnvelopeSchema.parse(envelope);
};

async function handleSessions(state: FairyCliState, parsed: ParsedArgs, cwd: string, asJson: boolean): Promise<number> {
  const action = parsed.positionals[1] ?? 'list';

  if (action === 'create') {
    const room = readFlagString(parsed.flags, 'room') ?? resolveMessage(parsed, 2);
    if (!room) throw new Error('sessions create requires --room <canvas-room>');
    const baseUrl = readFlagString(parsed.flags, 'baseUrl') ?? FAIRY_CLI_DEFAULT_BASE_URL;
    const name = readFlagString(parsed.flags, 'name') ?? undefined;
    const session = createSession({ room, name, baseUrl });
    const next = {
      ...upsertSession(state, session),
      currentSessionId: session.id,
    };
    await saveState(cwd, next);
    printResult({ ok: true, session, currentSessionId: session.id }, asJson);
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  if (action === 'use') {
    const sessionId = parsed.positionals[2];
    if (!sessionId) throw new Error('sessions use requires a session id');
    const session = getSessionById(state, sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const next = { ...state, currentSessionId: session.id };
    await saveState(cwd, next);
    printResult({ ok: true, currentSessionId: session.id, session }, asJson);
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  if (action === 'inspect') {
    const sessionId = parsed.positionals[2] ?? state.currentSessionId;
    const session = getSessionById(state, sessionId);
    if (!session) throw new Error('No matching session to inspect');
    printResult({ ok: true, session, current: state.currentSessionId === session.id }, asJson);
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  if (action === 'send') {
    const session = resolveSession(state, parsed);
    const task = readFlagString(parsed.flags, 'task') ?? 'fairy.intent';
    const message = resolveMessage(parsed, 2);
    const token = readFlagString(parsed.flags, 'token') ?? process.env.FAIRY_CLI_BEARER_TOKEN ?? undefined;
    const wait = readFlagBoolean(parsed.flags, 'wait', true);
    const timeoutMs = readFlagNumber(parsed.flags, 'timeoutMs', 45_000);
    const params = parseJsonFlag(parsed.flags, 'args');
    const envelope = buildRunEnvelope(session, {
      task,
      message: message ?? undefined,
      params,
      requestId: readFlagString(parsed.flags, 'requestId') ?? undefined,
      traceId: readFlagString(parsed.flags, 'traceId') ?? undefined,
      intentId: readFlagString(parsed.flags, 'intentId') ?? undefined,
      executionId: readFlagString(parsed.flags, 'executionId') ?? undefined,
      idempotencyKey: readFlagString(parsed.flags, 'idempotencyKey') ?? undefined,
      lockKey: readFlagString(parsed.flags, 'lockKey') ?? undefined,
      attempt: readFlagNumber(parsed.flags, 'attempt', 1),
      experimentId: readFlagString(parsed.flags, 'experimentId') ?? undefined,
      variantId: readFlagString(parsed.flags, 'variantId') ?? undefined,
      assignmentNamespace: readFlagString(parsed.flags, 'assignmentNamespace') ?? undefined,
      assignmentUnit:
        (readFlagString(parsed.flags, 'assignmentUnit') as 'room_session' | null) ?? undefined,
      assignmentTs: readFlagString(parsed.flags, 'assignmentTs') ?? undefined,
      factorLevels: (() => {
        const parsedFactorLevels = parseJsonFlag(parsed.flags, 'factorLevels');
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsedFactorLevels)) {
          if (typeof value !== 'string') continue;
          const trimmed = value.trim();
          if (!trimmed) continue;
          next[key] = trimmed;
        }
        return Object.keys(next).length > 0 ? next : undefined;
      })(),
    });
    const baseUrl = readFlagString(parsed.flags, 'baseUrl') ?? session.baseUrl;
    const result = await sendRunAndMaybeWait({ baseUrl, token }, envelope, wait, timeoutMs);

    const nextSession = updateSessionWithMutation(session, result);
    const nextState = {
      ...upsertSession(state, nextSession),
      currentSessionId: nextSession.id,
    };
    await saveState(cwd, nextState);
    printResult({ ok: true, result, session: nextSession }, asJson);
    return exitCodeForMutation(result);
  }

  if (action === 'list') {
    printResult(
      {
        ok: true,
        currentSessionId: state.currentSessionId ?? null,
        sessions: state.sessions,
      },
      asJson,
    );
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  throw new Error(`Unknown sessions action: ${action}`);
}

async function handleTools(state: FairyCliState, parsed: ParsedArgs, asJson: boolean): Promise<number> {
  const action = parsed.positionals[1] ?? 'list';
  if (action === 'list') {
    const profile = parseTeacherProfile(readFlagString(parsed.flags, 'profile'));
    const metadata = getTeacherContractMetadata(profile);
    const actionNames = TEACHER_ACTIONS_BY_PROFILE[profile];
    const actionCatalog = actionNames.map((name) => {
      if (profile === 'fairy48') {
        const parity = getFairyParityEntry(name as (typeof TEACHER_ACTIONS_BY_PROFILE.fairy48)[number]);
        return {
          name,
          class: parity.class,
          executor: parity.executor,
          ready: parity.ready,
          sideEffect: parity.sideEffect,
        };
      }
      return {
        name,
        class: 'legacy',
        executor: 'canvas-dispatch',
        ready: true,
      };
    });
    const tools = fairyCliTaskSchema.options.map((task) => ({
      name: task,
      execution: 'runCanvas',
      statusTracking: '/api/steward/task-status',
    }));
    printResult(
      {
        ok: true,
        tools,
        profile,
        contract: metadata,
        actionCatalog: {
          count: actionNames.length,
          actions: actionCatalog,
          paritySummary: profile === 'fairy48' ? getFairyParitySummary() : null,
        },
      },
      asJson,
    );
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  if (action === 'call') {
    const toolName = parsed.positionals[2];
    if (!toolName) throw new Error('tools call requires a task name');
    const session = resolveSession(state, parsed);
    const wait = readFlagBoolean(parsed.flags, 'wait', true);
    const timeoutMs = readFlagNumber(parsed.flags, 'timeoutMs', 45_000);
    const token = readFlagString(parsed.flags, 'token') ?? process.env.FAIRY_CLI_BEARER_TOKEN ?? undefined;
    const baseUrl = readFlagString(parsed.flags, 'baseUrl') ?? session.baseUrl;
    const args = parseJsonFlag(parsed.flags, 'args');

    if (toolName === 'dispatch_to_conductor') {
      const dispatchTask = readString(args.task);
      if (!dispatchTask) throw new Error('dispatch_to_conductor requires args.task');
      const dispatchParams =
        args.params && typeof args.params === 'object' && !Array.isArray(args.params)
          ? (args.params as Record<string, unknown>)
          : {};
      const envelope = buildRunEnvelope(session, {
        task: dispatchTask,
        message: readString(dispatchParams.message) ?? undefined,
        params: dispatchParams,
        requestId: readFlagString(parsed.flags, 'requestId') ?? undefined,
      });
      const result = await sendRunAndMaybeWait({ baseUrl, token }, envelope, wait, timeoutMs);
      printResult({ ok: true, result, via: toolName }, asJson);
      return exitCodeForMutation(result);
    }

    if (!FAIRY_TASK_SET.has(toolName)) {
      throw new Error(
        `Unsupported tool task "${toolName}". Use one of: ${fairyCliTaskSchema.options.join(', ')} or dispatch_to_conductor.`,
      );
    }

    const envelope = buildRunEnvelope(session, {
      task: toolName,
      message: resolveMessage(parsed, 3) ?? undefined,
      params: args,
      requestId: readFlagString(parsed.flags, 'requestId') ?? undefined,
    });
    const result = await sendRunAndMaybeWait({ baseUrl, token }, envelope, wait, timeoutMs);
    printResult({ ok: true, result }, asJson);
    return exitCodeForMutation(result);
  }

  throw new Error(`Unknown tools action: ${action}`);
}

async function handleSubagents(state: FairyCliState, parsed: ParsedArgs, cwd: string, asJson: boolean): Promise<number> {
  const action = parsed.positionals[1] ?? 'list';
  const session = resolveSession(state, parsed);
  const token = readFlagString(parsed.flags, 'token') ?? process.env.FAIRY_CLI_BEARER_TOKEN ?? undefined;
  const baseUrl = readFlagString(parsed.flags, 'baseUrl') ?? session.baseUrl;

  if (action === 'spawn') {
    const message = resolveMessage(parsed, 2);
    if (!message) throw new Error('subagents spawn requires a message');
    const count = Math.max(1, Math.min(12, Math.floor(readFlagNumber(parsed.flags, 'count', 3))));
    const wait = readFlagBoolean(parsed.flags, 'wait', false);
    const timeoutMs = readFlagNumber(parsed.flags, 'timeoutMs', 45_000);
    const spawnId = `spawn-${randomUUID().slice(0, 10)}`;

    const tasks: FairyCliSubagentRun['tasks'] = [];
    for (let index = 1; index <= count; index += 1) {
      const requestId = `${spawnId}-req-${index}`;
      const intentId = `${spawnId}-intent-${index}`;
      const envelope = buildRunEnvelope(session, {
        task: 'fairy.intent',
        message,
        requestId,
        intentId,
        idempotencyKey: `${spawnId}-idem-${index}`,
        lockKey: `fairy-subagent:${spawnId}:${index}`,
        params: {
          source: 'cli-subagent',
          metadata: {
            origin: 'fairy-cli',
            subagent: { spawnId, index, count },
          },
        },
      });
      const result = await sendRunAndMaybeWait({ baseUrl, token }, envelope, wait, timeoutMs);
      tasks.push({
        index,
        taskId: result.taskId,
        requestId,
        intentId,
        status: result.status,
      });
    }

    const run: FairyCliSubagentRun = {
      id: spawnId,
      sessionId: session.id,
      room: session.room,
      message,
      count,
      createdAt: new Date().toISOString(),
      tasks,
    };
    const nextState: FairyCliState = {
      ...state,
      subagentRuns: [run, ...state.subagentRuns].slice(0, 100),
    };
    await saveState(cwd, nextState);
    printResult({ ok: true, run }, asJson);
    return tasks.some((task) => task.status === 'failed') ? FAIRY_CLI_EXIT_CODES.FAILED : FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  if (action === 'wait') {
    const runId = parsed.positionals[2];
    if (!runId) throw new Error('subagents wait requires a run id');
    const run = state.subagentRuns.find((entry) => entry.id === runId);
    if (!run) throw new Error(`Subagent run not found: ${runId}`);
    const timeoutMs = readFlagNumber(parsed.flags, 'timeoutMs', 60_000);
    const updatedTasks = await Promise.all(
      run.tasks.map(async (task) => {
        if (!task.taskId) return task;
        const snapshot = await pollTaskStatus({ baseUrl, token }, { taskId: task.taskId, room: run.room, timeoutMs });
        if (!snapshot) return { ...task, status: 'timeout' };
        if (snapshot.status === 'terminal') {
          return { ...task, status: snapshot.task.status.toLowerCase() };
        }
        if (snapshot.status === 'unauthorized') {
          return { ...task, status: 'unauthorized' };
        }
        return { ...task, status: 'timeout' };
      }),
    );
    const nextRun = { ...run, tasks: updatedTasks };
    const nextState: FairyCliState = {
      ...state,
      subagentRuns: state.subagentRuns.map((entry) => (entry.id === nextRun.id ? nextRun : entry)),
    };
    await saveState(cwd, nextState);
    printResult({ ok: true, run: nextRun }, asJson);
    if (updatedTasks.some((task) => task.status === 'timeout')) {
      return FAIRY_CLI_EXIT_CODES.TIMEOUT;
    }
    return updatedTasks.some((task) => task.status === 'failed' || task.status === 'canceled')
      ? FAIRY_CLI_EXIT_CODES.FAILED
      : FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  if (action === 'cancel') {
    const runId = parsed.positionals[2];
    if (!runId) throw new Error('subagents cancel requires a run id');
    const run = state.subagentRuns.find((entry) => entry.id === runId);
    if (!run) throw new Error(`Subagent run not found: ${runId}`);
    const reason = readFlagString(parsed.flags, 'reason') ?? 'Canceled from fairy CLI';
    const results: Array<{ taskId: string; ok: boolean; status: number; body: unknown }> = [];
    for (const task of run.tasks) {
      if (!task.taskId) continue;
      const response = await runAdminAction(
        { baseUrl, token },
        { action: 'cancel', targetTaskId: task.taskId, reason },
      );
      results.push({
        taskId: task.taskId,
        ok: response.response.ok,
        status: response.response.status,
        body: response.body,
      });
    }
    printResult({ ok: true, runId, results }, asJson);
    return results.every((result) => result.ok) ? FAIRY_CLI_EXIT_CODES.APPLIED : FAIRY_CLI_EXIT_CODES.FAILED;
  }

  if (action === 'list') {
    const sessionFilter = readFlagString(parsed.flags, 'session');
    const runs = sessionFilter
      ? state.subagentRuns.filter((run) => run.sessionId === sessionFilter)
      : state.subagentRuns;
    printResult({ ok: true, runs }, asJson);
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  throw new Error(`Unknown subagents action: ${action}`);
}

async function handleTrace(state: FairyCliState, parsed: ParsedArgs, asJson: boolean): Promise<number> {
  const action = parsed.positionals[1] ?? 'open';
  const session = resolveSession(state, parsed);
  const token = readFlagString(parsed.flags, 'token') ?? process.env.FAIRY_CLI_BEARER_TOKEN ?? undefined;
  const baseUrl = readFlagString(parsed.flags, 'baseUrl') ?? session.baseUrl;
  const room = readFlagString(parsed.flags, 'room') ?? session.room;
  const limit = readFlagNumber(parsed.flags, 'limit', 200);

  if (action === 'open' || action === 'timeline') {
    const response = await getTraceSession({ baseUrl, token }, { room, limit });
    printResult({ ok: response.response.ok, status: response.response.status, room, data: response.body }, asJson);
    return response.response.ok ? FAIRY_CLI_EXIT_CODES.APPLIED : FAIRY_CLI_EXIT_CODES.FAILED;
  }

  if (action === 'correlate') {
    const taskId = readFlagString(parsed.flags, 'taskId') ?? session.lastTaskId ?? null;
    const requestId = readFlagString(parsed.flags, 'requestId') ?? session.lastRequestId ?? null;
    const traceId = readFlagString(parsed.flags, 'traceId') ?? session.lastTraceId ?? null;
    const sessionResponse = await getTraceSession({ baseUrl, token }, { room, limit });
    const sessionBody =
      sessionResponse.body && typeof sessionResponse.body === 'object' && !Array.isArray(sessionResponse.body)
        ? (sessionResponse.body as Record<string, unknown>)
        : null;
    const traces = Array.isArray(sessionBody?.traces) ? sessionBody.traces : [];
    const tasks = Array.isArray(sessionBody?.tasks) ? sessionBody.tasks : [];
    const traceCandidates = new Set([traceId, requestId].filter(Boolean));
    const taskCandidates = new Set([taskId, requestId].filter(Boolean));
    const matchedTraces = traces
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      .filter((entry) => {
      const candidateTraceId = readString(entry?.trace_id) ?? readString(entry?.traceId);
      const candidateRequestId = readString(entry?.request_id) ?? readString(entry?.requestId);
      const candidateTaskId = readString(entry?.task_id) ?? readString(entry?.taskId);
      return (
        (candidateTraceId && traceCandidates.has(candidateTraceId)) ||
        (candidateRequestId && taskCandidates.has(candidateRequestId)) ||
        (candidateTaskId && taskCandidates.has(candidateTaskId))
      );
      });
    const matchedTasks = tasks
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      .filter((entry) => {
      const candidateId = readString(entry?.id);
      const candidateRequestId = readString(entry?.request_id) ?? readString(entry?.requestId);
      const candidateTraceId = readString(entry?.trace_id) ?? readString(entry?.traceId);
      return (
        (candidateId && taskCandidates.has(candidateId)) ||
        (candidateRequestId && taskCandidates.has(candidateRequestId)) ||
        (candidateTraceId && traceCandidates.has(candidateTraceId))
      );
      });
    printResult(
      {
        ok: sessionResponse.response.ok,
        status: sessionResponse.response.status,
        room,
        correlation: {
          taskId,
          requestId,
          traceId,
          matchedTaskCount: matchedTasks.length,
          matchedTraceCount: matchedTraces.length,
          matchedTasks,
          matchedTraces,
        },
      },
      asJson,
    );
    return sessionResponse.response.ok ? FAIRY_CLI_EXIT_CODES.APPLIED : FAIRY_CLI_EXIT_CODES.FAILED;
  }

  throw new Error(`Unknown trace action: ${action}`);
}

async function handleSmoke(state: FairyCliState, parsed: ParsedArgs, cwd: string, asJson: boolean): Promise<number> {
  const action = parsed.positionals[1] ?? 'run';
  if (action === 'showcase-loop') {
    const args = parsed.positionals.slice(2);
    return runChildScript(cwd, 'scripts/observability/playwright-voice-showcase-loop.mjs', args);
  }
  if (action === 'correlate') {
    const args = parsed.positionals.slice(2);
    return runChildScript(cwd, 'scripts/observability/playwright-smoke-and-correlate.mjs', args);
  }
  if (action !== 'run') {
    throw new Error(`Unknown smoke action: ${action}`);
  }

  const preset = readFlagString(parsed.flags, 'preset') ?? parsed.positionals[2] ?? 'full';
  const session = resolveSession(state, parsed);
  const baseUrl = readFlagString(parsed.flags, 'baseUrl') ?? session.baseUrl;
  const token = readFlagString(parsed.flags, 'token') ?? process.env.FAIRY_CLI_BEARER_TOKEN ?? undefined;
  const timeoutMs = readFlagNumber(parsed.flags, 'timeoutMs', 60_000);
  const results: Array<{ step: string; result: FairyCliMutationResult }> = [];

  const runStep = async (step: string, envelope: FairyCliRunEnvelope) => {
    const result = await sendRunAndMaybeWait({ baseUrl, token }, envelope, true, timeoutMs);
    results.push({ step, result });
    return result;
  };

  if (preset === 'bunny' || preset === 'full') {
    await runStep(
      'bunny',
      buildRunEnvelope(session, {
        task: 'fairy.intent',
        message: 'Draw a simple bunny with two ears, head, body, and tail.',
      }),
    );
  }
  if (preset === 'forest' || preset === 'full') {
    for (let index = 1; index <= 3; index += 1) {
      await runStep(
        `forest-${index}`,
        buildRunEnvelope(session, {
          task: 'fairy.intent',
          message: `Draw tree ${index} in a small forest scene near the bunny.`,
          requestId: `smoke-forest-${index}-${randomUUID().slice(0, 6)}`,
          idempotencyKey: `smoke-forest-${index}`,
          lockKey: `smoke-forest:${index}`,
        }),
      );
    }
  }
  if (preset === 'sticky' || preset === 'full') {
    await runStep(
      'sticky',
      buildRunEnvelope(session, {
        task: 'canvas.quick_text',
        message: 'BUNNY_LOOKS_ENERGETIC.',
        params: {
          text: 'BUNNY_LOOKS_ENERGETIC.',
        },
      }),
    );
  }

  printResult({ ok: true, preset, room: session.room, results }, asJson);
  if (results.some((entry) => entry.result.status === 'failed')) {
    return FAIRY_CLI_EXIT_CODES.FAILED;
  }
  if (results.some((entry) => entry.result.status === 'timeout')) {
    return FAIRY_CLI_EXIT_CODES.TIMEOUT;
  }
  if (results.some((entry) => entry.result.status === 'unauthorized' || entry.result.status === 'invalid')) {
    return FAIRY_CLI_EXIT_CODES.AUTH_OR_CONFIG;
  }
  if (results.some((entry) => entry.result.status === 'queued')) {
    return FAIRY_CLI_EXIT_CODES.QUEUED;
  }
  return FAIRY_CLI_EXIT_CODES.APPLIED;
}

function printUsage() {
  const usage = `
fairy <group> <action> [options]

Groups:
  sessions create|use|list|inspect|send
  tools list|call
  subagents spawn|list|wait|cancel
  trace open|timeline|correlate
  smoke run|showcase-loop|correlate

Global options:
  --json
  --baseUrl=http://127.0.0.1:3000
  --token=<bearer-token> (or FAIRY_CLI_BEARER_TOKEN)
`;
  process.stdout.write(`${usage.trim()}\n`);
}

export async function runCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const parsed = parseArgs(argv);
  const asJson = readFlagBoolean(parsed.flags, 'json', false);
  const [group] = parsed.positionals;
  if (!group || group === 'help' || group === '--help' || group === '-h') {
    printUsage();
    return FAIRY_CLI_EXIT_CODES.APPLIED;
  }

  const state = await loadState(cwd);
  try {
    if (group === 'sessions') {
      return await handleSessions(state, parsed, cwd, asJson);
    }
    if (group === 'tools') {
      return await handleTools(state, parsed, asJson);
    }
    if (group === 'subagents') {
      return await handleSubagents(state, parsed, cwd, asJson);
    }
    if (group === 'trace') {
      return await handleTrace(state, parsed, asJson);
    }
    if (group === 'smoke') {
      return await handleSmoke(state, parsed, cwd, asJson);
    }
    throw new Error(`Unknown command group: ${group}`);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error), asJson);
    return FAIRY_CLI_EXIT_CODES.FAILED;
  }
}

const invokedDirectly = (() => {
  const argv1 = process.argv[1] ?? '';
  return argv1.endsWith('/src/cli/fairy/index.ts') || argv1.endsWith('\\src\\cli\\fairy\\index.ts');
})();

if (invokedDirectly) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
