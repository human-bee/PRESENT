const inbox = new Map<string, Set<number>>();

export function recordAck(sessionId: string, seq: number) {
  const set = inbox.get(sessionId) || new Set<number>();
  set.add(seq);
  inbox.set(sessionId, set);
}

export function hasAck(sessionId: string, seq: number): boolean {
  const set = inbox.get(sessionId);
  return Boolean(set && set.has(seq));
}





