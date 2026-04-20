import type { CodexBrokerSessionSnapshot } from './session-store';
import type { CreateCodexBrokerSessionInput } from './service';

const resolveBrokerBaseUrl = () => {
  const explicit = process.env.CODEX_BROKER_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = process.env.CODEX_BROKER_PORT?.trim() || '4101';
  return `http://127.0.0.1:${port}`;
};

async function brokerRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${resolveBrokerBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Codex broker request failed (${response.status}).`);
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export async function createCodexBrokerSession(input: CreateCodexBrokerSessionInput) {
  return brokerRequest<{ session: CodexBrokerSessionSnapshot }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getCodexBrokerSession(sessionId: string) {
  return brokerRequest<{ session: CodexBrokerSessionSnapshot }>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function deleteCodexBrokerSession(sessionId: string) {
  return brokerRequest<{ deleted: boolean }>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}
