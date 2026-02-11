const stripWrappingQuotes = (value: string) => {
  let next = value.trim();
  if (next.length < 2) return next;
  const first = next[0];
  const last = next[next.length - 1];
  if ((first === '"' || first === "'" || first === '`') && first === last) {
    next = next.slice(1, -1).trim();
  }
  return next;
};

export const inferScorecardTopicFromText = (text?: string): string | undefined => {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (!lower.includes('debate') && !lower.includes('scorecard')) return undefined;

  const markers = ['about:', 'about ', 'topic:', 'topic is', 'topic '];
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx === -1) continue;
    const candidate = stripWrappingQuotes(trimmed.slice(idx + marker.length).trim());
    if (candidate.length >= 6 && candidate.length <= 180) {
      return candidate;
    }
  }

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon !== -1) {
    const candidate = stripWrappingQuotes(trimmed.slice(lastColon + 1).trim());
    if (candidate.length >= 6 && candidate.length <= 180) {
      return candidate;
    }
  }

  if (trimmed.endsWith('?') && trimmed.length <= 180) {
    return trimmed;
  }

  return undefined;
};

export const dedupeParticipantLabels = (labels: string[]): string[] => {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const resolveDebatePlayerSeedFromLabels = (labels: string[]) => {
  const deduped = dedupeParticipantLabels(labels);
  const affLabel = deduped[0] || 'You';
  const negLabel = deduped[1] || (deduped[0] ? 'Opponent' : 'Opponent');
  return [
    { side: 'AFF' as const, label: affLabel },
    { side: 'NEG' as const, label: negLabel },
  ];
};
