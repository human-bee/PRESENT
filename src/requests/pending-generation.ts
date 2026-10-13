export type PendingGeneration = {
  requestId: string; roomId: string; actor: string; prompt: string; payload: Record<string, unknown>;
  attempt: number; outcome: 'uncertain' | 'running' | 'failed' | 'missing' | 'interrupted';
};
const key = (roomId: string, actor: string) => `present:pending-generation:${roomId}:${actor}`;

export function savePendingGeneration(input: Record<string, unknown> & { roomId: string; actor: string; prompt: string }): PendingGeneration {
  const pending: PendingGeneration = { requestId: crypto.randomUUID(), roomId: input.roomId, actor: input.actor, prompt: input.prompt, payload: JSON.parse(JSON.stringify(input)), attempt: 0, outcome: 'uncertain' };
  return updatePendingGeneration(pending);
}

export function updatePendingGeneration(pending: PendingGeneration): PendingGeneration {
  const { roomId, actor } = pending;
  try { sessionStorage.setItem(key(roomId, actor), JSON.stringify(pending)); }
  catch { throw new Error('This browser could not save the request for recovery. Free session storage before starting generation.'); }
  return pending;
}

export function loadPendingGeneration(roomId: string, actor: string): PendingGeneration | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(roomId, actor)) ?? 'null') as PendingGeneration | null;
    if (!value || value.roomId !== roomId || value.actor !== actor || !/^[a-zA-Z0-9-]{16,64}$/.test(value.requestId)) return null;
    if (typeof value.prompt !== 'string' || value.prompt.length > 3000 || !value.payload || typeof value.payload !== 'object') return null;
    if (value.payload.roomId !== roomId || value.payload.actor !== actor || value.payload.prompt !== value.prompt) return null;
    if (value.payload.canvasImage !== undefined && (typeof value.payload.canvasImage !== 'string' || value.payload.canvasImage.length > 1500000)) return null;
    if (value.attempt !== undefined && value.attempt !== 0 && value.attempt !== 1) return null;
    if (value.outcome !== undefined && !['uncertain', 'running', 'failed', 'missing', 'interrupted'].includes(value.outcome)) return null;
    return { ...value, attempt: value.attempt ?? 0, outcome: value.outcome ?? 'uncertain' };
  } catch { return null; }
}

export function forgetPendingGeneration(roomId: string, actor: string) {
  try { sessionStorage.removeItem(key(roomId, actor)); } catch { /* Browser storage may be unavailable. */ }
}
