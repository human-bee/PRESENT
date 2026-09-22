export type PendingGeneration = {
  requestId: string; roomId: string; actor: string; prompt: string; payload: Record<string, unknown>;
};
const key = (roomId: string, actor: string) => `present:pending-generation:${roomId}:${actor}`;

export function savePendingGeneration(input: Record<string, unknown> & { roomId: string; actor: string; prompt: string }): PendingGeneration {
  const pending = { requestId: crypto.randomUUID(), roomId: input.roomId, actor: input.actor, prompt: input.prompt, payload: input };
  try { sessionStorage.setItem(key(input.roomId, input.actor), JSON.stringify(pending)); } catch { /* The request can still run in this session. */ }
  return pending;
}

export function loadPendingGeneration(roomId: string, actor: string): PendingGeneration | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(roomId, actor)) ?? 'null') as PendingGeneration | null;
    if (!value || value.roomId !== roomId || value.actor !== actor || !/^[a-zA-Z0-9-]{16,64}$/.test(value.requestId)) return null;
    if (typeof value.prompt !== 'string' || value.prompt.length > 3000 || !value.payload || typeof value.payload !== 'object') return null;
    if (value.payload.roomId !== roomId || value.payload.actor !== actor || value.payload.prompt !== value.prompt) return null;
    return value;
  } catch { return null; }
}

export function forgetPendingGeneration(roomId: string, actor: string) {
  try { sessionStorage.removeItem(key(roomId, actor)); } catch { /* Browser storage may be unavailable. */ }
}
