import { buildRuntimeManifest } from '@present/kernel';
import { CODEX_APP_SERVER_ENDPOINTS, CODEX_AUTH_MODES, CODEX_MODEL_POLICY } from './models';

export type CodexAppServerRequestInit = {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export function getCodexAppServerBaseUrl() {
  return process.env.CODEX_APP_SERVER_URL ?? buildRuntimeManifest().codex.appServerBaseUrl;
}

export function buildCodexAppServerManifest() {
  return {
    baseUrl: getCodexAppServerBaseUrl(),
    authModes: [...CODEX_AUTH_MODES],
    endpoints: CODEX_APP_SERVER_ENDPOINTS,
    models: CODEX_MODEL_POLICY,
  };
}

export async function codexAppServerRequest<T = unknown>(
  path: string,
  init: CodexAppServerRequestInit = {},
) {
  const response = await fetch(new URL(path, getCodexAppServerBaseUrl()), {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Codex app-server request failed (${response.status}): ${text}`);
  }

  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function startCodexChatGptLogin() {
  return codexAppServerRequest(CODEX_APP_SERVER_ENDPOINTS.loginStart, { method: 'POST' });
}

export async function startCodexThread(input: {
  workspacePath: string;
  workspaceSessionId: string;
  executorSessionId?: string;
}) {
  return codexAppServerRequest(CODEX_APP_SERVER_ENDPOINTS.threadStart, {
    method: 'POST',
    body: input,
  });
}

export async function startCodexTurnRequest(input: {
  threadId: string;
  workspaceSessionId: string;
  taskRunId: string;
  prompt: string;
  model?: string;
}) {
  return codexAppServerRequest(CODEX_APP_SERVER_ENDPOINTS.turnStart, {
    method: 'POST',
    body: input,
  });
}

export async function getCodexTurnStatus(input: {
  taskRunId: string;
  threadId?: string;
}) {
  const params = new URLSearchParams({ taskRunId: input.taskRunId });
  if (input.threadId) params.set('threadId', input.threadId);
  return codexAppServerRequest(`${CODEX_APP_SERVER_ENDPOINTS.turnStatus}?${params.toString()}`);
}
