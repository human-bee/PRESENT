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

export type ManualScorecardClaimPatch = {
  side: 'AFF' | 'NEG';
  speech: '1AC' | '1NC' | '1AR' | '1NR';
  quote: string;
  summary: string;
};

const normalizeClaimQuote = (value: string): string | null => {
  const stripped = stripWrappingQuotes(value).trim().replace(/[.]+$/, '');
  if (stripped.length < 3) return null;
  return stripped.slice(0, 480);
};

const buildManualClaimPatch = (
  side: 'AFF' | 'NEG',
  quoteCandidate: string,
  isRebuttal: boolean,
): ManualScorecardClaimPatch | null => {
  const quote = normalizeClaimQuote(quoteCandidate);
  if (!quote) return null;
  const speech: ManualScorecardClaimPatch['speech'] = side === 'AFF'
    ? isRebuttal
      ? '1AR'
      : '1AC'
    : isRebuttal
      ? '1NR'
      : '1NC';
  return {
    side,
    speech,
    quote,
    summary: quote.slice(0, 120),
  };
};

export const parseManualScorecardClaimPatch = (
  text?: string,
): ManualScorecardClaimPatch | null => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const prefixed =
    trimmed.match(/^affirmative\s+rebuttal\s*:\s*(.+)$/i) ??
    trimmed.match(/^negative\s+rebuttal\s*:\s*(.+)$/i) ??
    trimmed.match(/^affirmative\s*:\s*(.+)$/i) ??
    trimmed.match(/^negative\s*:\s*(.+)$/i);
  if (prefixed?.[1]) {
    const lowerPrefix = trimmed.toLowerCase();
    const isNegative = lowerPrefix.startsWith('negative');
    const isRebuttal = lowerPrefix.startsWith('affirmative rebuttal') || lowerPrefix.startsWith('negative rebuttal');
    return buildManualClaimPatch(isNegative ? 'NEG' : 'AFF', prefixed[1], isRebuttal);
  }

  const addClaimMatch = trimmed.match(
    /(?:add|create|make)\s+(?:an?\s+)?(affirmative|negative)\s+(rebuttal|claim)?\s*:?\s*(.+)$/i,
  );
  if (addClaimMatch?.[1] && addClaimMatch?.[3]) {
    const side = addClaimMatch[1].toLowerCase().startsWith('neg') ? 'NEG' : 'AFF';
    const rebuttalFlag = (addClaimMatch[2] || '').toLowerCase().includes('rebuttal');
    return buildManualClaimPatch(side, addClaimMatch[3], rebuttalFlag);
  }

  return null;
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
