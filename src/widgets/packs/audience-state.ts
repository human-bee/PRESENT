/** One participant owns one boolean vote key for each question. */
export function questionVotePatch(state: Record<string, unknown>, questionId: string, participantId: string, voted: boolean): Record<string, boolean> | null {
  if (!/^[\w-]{1,100}$/.test(questionId) || !participantId || participantId.length > 100 || typeof voted !== 'boolean') return null;
  const question = state[`question:${questionId}`];
  if (!question || typeof question !== 'object' || !('id' in question) || question.id !== questionId || state[`questionStatus:${questionId}`] === 'resolved') return null;
  try { return { [`vote:${questionId}:${encodeURIComponent(participantId)}`]: voted }; }
  catch { return null; }
}

export function questionVoteCount(state: Record<string, unknown>, questionId: string): number {
  const prefix = `vote:${questionId}:`;
  const voters = new Set<string>();
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith(prefix) || value !== true) continue;
    const suffix = key.slice(prefix.length);
    try {
      const participant = decodeURIComponent(suffix);
      if (participant && participant.length <= 100 && encodeURIComponent(participant) === suffix) voters.add(participant);
    } catch { /* Malformed keys do not represent a participant vote. */ }
  }
  return voters.size;
}

/** Resolving A must not clear a newer active question B from another participant. */
export function questionStatusPatch(questionId: string, status: 'open' | 'resolved'): Record<string, string> {
  if (!/^[\w-]{1,100}$/.test(questionId) || !['open', 'resolved'].includes(status)) throw new Error('Invalid question status.');
  return { [`questionStatus:${questionId}`]: status };
}
