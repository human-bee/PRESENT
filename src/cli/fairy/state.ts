import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type FairyCliSession = {
  id: string;
  room: string;
  name?: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
  lastTaskId?: string | null;
  lastTraceId?: string | null;
  lastRequestId?: string | null;
};

export type FairyCliSpawnTask = {
  index: number;
  taskId: string | null;
  requestId: string;
  intentId: string;
  status: string;
};

export type FairyCliSubagentRun = {
  id: string;
  sessionId: string;
  room: string;
  message: string;
  count: number;
  createdAt: string;
  tasks: FairyCliSpawnTask[];
};

export type FairyCliState = {
  currentSessionId?: string;
  sessions: FairyCliSession[];
  subagentRuns: FairyCliSubagentRun[];
};

const DEFAULT_STATE: FairyCliState = {
  sessions: [],
  subagentRuns: [],
};

const stateDirPath = (cwd: string) => path.join(cwd, '.fairy-cli');
const stateFilePath = (cwd: string) => path.join(stateDirPath(cwd), 'state.json');

export async function loadState(cwd: string): Promise<FairyCliState> {
  const file = stateFilePath(cwd);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as FairyCliState;
    return {
      currentSessionId: typeof parsed.currentSessionId === 'string' ? parsed.currentSessionId : undefined,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      subagentRuns: Array.isArray(parsed.subagentRuns) ? parsed.subagentRuns : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(cwd: string, state: FairyCliState): Promise<void> {
  const dir = stateDirPath(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(stateFilePath(cwd), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function createSession(input: { room: string; name?: string; baseUrl: string }): FairyCliSession {
  const now = new Date().toISOString();
  return {
    id: `session-${randomUUID().slice(0, 12)}`,
    room: input.room,
    name: input.name,
    baseUrl: input.baseUrl,
    createdAt: now,
    updatedAt: now,
    lastTaskId: null,
    lastTraceId: null,
    lastRequestId: null,
  };
}

export function upsertSession(state: FairyCliState, session: FairyCliSession): FairyCliState {
  const nextSessions = state.sessions.filter((existing) => existing.id !== session.id);
  nextSessions.push(session);
  return {
    ...state,
    sessions: nextSessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export function getSessionById(state: FairyCliState, sessionId: string | undefined): FairyCliSession | null {
  if (!sessionId) return null;
  return state.sessions.find((session) => session.id === sessionId) ?? null;
}

export function getCurrentSession(state: FairyCliState): FairyCliSession | null {
  return getSessionById(state, state.currentSessionId);
}
