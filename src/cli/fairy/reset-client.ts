type ClientOptions = {
  baseUrl: string;
  token?: string;
};

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const jsonHeaders = (token?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const bearer = readString(token);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
};

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestResetJson(
  options: ClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(new URL(path, options.baseUrl), {
    ...init,
    headers: {
      ...jsonHeaders(options.token),
      ...(init.headers ?? {}),
    },
  });
  const body = await parseJsonSafe(response);
  return { response, body };
}

export async function openResetWorkspace(
  options: ClientOptions,
  input: { workspacePath: string; branch?: string; title?: string; ownerUserId?: string },
) {
  return requestResetJson(options, '/api/reset/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getResetWorkspaceState(
  options: ClientOptions,
  input: { workspaceSessionId: string },
) {
  return requestResetJson(
    options,
    `/api/reset/workspaces/${encodeURIComponent(input.workspaceSessionId)}/state`,
  );
}

export async function listResetWorkspaceFiles(
  options: ClientOptions,
  input: { workspaceSessionId: string; directoryPath?: string; limit?: number },
) {
  const search = new URLSearchParams();
  if (input.directoryPath) search.set('directoryPath', input.directoryPath);
  if (typeof input.limit === 'number') search.set('limit', String(input.limit));
  const query = search.toString();
  return requestResetJson(
    options,
    `/api/reset/workspaces/${encodeURIComponent(input.workspaceSessionId)}/files${query ? `?${query}` : ''}`,
  );
}

export async function readResetWorkspaceFile(
  options: ClientOptions,
  input: { workspaceSessionId: string; filePath: string },
) {
  const search = new URLSearchParams({ filePath: input.filePath });
  return requestResetJson(
    options,
    `/api/reset/workspaces/${encodeURIComponent(input.workspaceSessionId)}/file?${search.toString()}`,
  );
}

export async function writeResetWorkspaceFile(
  options: ClientOptions,
  input: { workspaceSessionId: string; filePath: string; content: string },
) {
  return requestResetJson(
    options,
    `/api/reset/workspaces/${encodeURIComponent(input.workspaceSessionId)}/file`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
}

export async function createResetPatchArtifact(
  options: ClientOptions,
  input: { workspaceSessionId: string; filePath: string; nextContent: string; traceId?: string; title?: string },
) {
  return requestResetJson(
    options,
    `/api/reset/workspaces/${encodeURIComponent(input.workspaceSessionId)}/files`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function applyResetPatchArtifact(
  options: ClientOptions,
  input: { artifactId: string },
) {
  return requestResetJson(options, `/api/reset/artifacts/${encodeURIComponent(input.artifactId)}/apply`, {
    method: 'POST',
  });
}

export async function startResetTurn(
  options: ClientOptions,
  input: {
    workspaceSessionId: string;
    prompt: string;
    summary: string;
    executorSessionId?: string;
    threadId?: string;
    model?: string;
  },
) {
  return requestResetJson(options, '/api/reset/turns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getResetTask(
  options: ClientOptions,
  input: { taskId: string },
) {
  return requestResetJson(options, `/api/reset/tasks/${encodeURIComponent(input.taskId)}`);
}

export async function searchResetTrace(
  options: ClientOptions,
  input: { query?: string; traceId?: string },
) {
  const search = new URLSearchParams();
  if (input.query) search.set('query', input.query);
  if (input.traceId) search.set('traceId', input.traceId);
  const query = search.toString();
  return requestResetJson(options, `/api/reset/traces${query ? `?${query}` : ''}`);
}

export async function getResetManifest(
  options: ClientOptions,
  input: { workspaceSessionId?: string } = {},
) {
  const search = new URLSearchParams();
  if (input.workspaceSessionId) search.set('workspaceSessionId', input.workspaceSessionId);
  const query = search.toString();
  return requestResetJson(options, `/api/reset/runtime-manifest${query ? `?${query}` : ''}`);
}
