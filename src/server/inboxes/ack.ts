type AckRecord = {
  seq: number;
  clientId: string;
  ts: number;
};

const inbox = new Map<string, Map<number, AckRecord>>();

export function recordAck(sessionId: string, seq: number, clientId: string, ts: number) {
  const session = inbox.get(sessionId) ?? new Map<number, AckRecord>();
  if (!session.has(seq)) {
    session.set(seq, { seq, clientId, ts });
    inbox.set(sessionId, session);
  }
}

export function getAck(sessionId: string, seq: number): AckRecord | null {
  const session = inbox.get(sessionId);
  if (!session) return null;
  return session.get(seq) ?? null;
}

export function clearAcks() {
  inbox.clear();
}




