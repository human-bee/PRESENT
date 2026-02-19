export type CrowdPulsePatch = {
  title?: string;
  prompt?: string;
  status?: 'idle' | 'counting' | 'locked' | 'q_and_a';
  handCount?: number;
  peakCount?: number;
  confidence?: number;
  noiseLevel?: number;
  activeQuestion?: string;
  questions?: Array<{
    id: string;
    text: string;
    votes?: number;
    status?: string;
    tags?: string[];
    speaker?: string;
  }>;
  scoreboard?: Array<{ label: string; score: number; delta?: number }>;
  followUps?: string[];
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

export const normalizeCrowdPulseStatus = (value: unknown): CrowdPulsePatch['status'] | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'idle' || normalized === 'counting' || normalized === 'locked' || normalized === 'q_and_a') {
    return normalized;
  }
  if (normalized === 'q&a' || normalized === 'qa' || normalized === 'q and a') {
    return 'q_and_a';
  }
  return undefined;
};

export const shouldClearCrowdPulseQuestion = (instruction?: string): boolean => {
  if (typeof instruction !== 'string') return false;
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) return false;
  const hasQuestionTarget = /\b(question|prompt)\b/.test(normalized);
  if (!hasQuestionTarget) return false;
  return /\b(clear|remove|reset|unset|delete)\b/.test(normalized);
};

export const normalizeCrowdPulseActiveQuestionInput = (
  value: unknown,
  instruction?: string,
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 0) return trimmed;
  return shouldClearCrowdPulseQuestion(instruction) ? '' : undefined;
};

const parseCountToken = (value: string): number | undefined => {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (!cleaned) return undefined;
  const numeric = Number(cleaned);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.round(numeric));
  }
  if (cleaned in NUMBER_WORDS) {
    return NUMBER_WORDS[cleaned];
  }
  return undefined;
};

const parseConfidence = (instruction: string): number | undefined => {
  const match = instruction.match(/confidence(?:\s*(?:to|is|=))?\s*([0-9]+(?:\.[0-9]+)?)\s*(%?)/i);
  if (!match) return undefined;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return undefined;
  const percent = match[2] === '%' || raw > 1;
  const normalized = percent ? raw / 100 : raw;
  return Math.max(0, Math.min(1, normalized));
};

const extractQuestion = (instruction: string): string | undefined => {
  const explicit =
    instruction.match(/add\s+question(?:\s*(?:to|is|:|=))?\s*["“]?([^"”\n]+)["”]?/i) ||
    instruction.match(/question(?:\s*(?:to|is|:|=))?\s*["“]?([^"”\n]+)["”]?/i);
  if (explicit?.[1]) {
    const text = explicit[1].trim().replace(/[.]+$/, '');
    return text || undefined;
  }
  const sentence = instruction.match(/([^.!?\n]*\?)/);
  if (sentence?.[1]) {
    const text = sentence[1].trim();
    return text || undefined;
  }
  return undefined;
};

export const parseCrowdPulseFallbackInstruction = (instruction?: string): CrowdPulsePatch => {
  const trimmedInstruction = typeof instruction === 'string' ? instruction.trim() : '';
  if (!trimmedInstruction) return {};

  const patch: CrowdPulsePatch = {};

  const handCountMatch =
    trimmedInstruction.match(/(?:hand\s*count|hands?\s*up)(?:\s*(?:to|is|=))?\s*([a-z0-9.-]+)/i) ??
    trimmedInstruction.match(/\bhands?\s+([a-z0-9.-]+)\b/i);
  if (handCountMatch?.[1]) {
    const parsed = parseCountToken(handCountMatch[1]);
    if (typeof parsed === 'number') {
      patch.handCount = parsed;
    }
  }

  const confidence = parseConfidence(trimmedInstruction);
  if (typeof confidence === 'number') {
    patch.confidence = confidence;
  }

  const statusMatch = trimmedInstruction.match(/status(?:\s*(?:to|is|=))?\s*([a-z0-9_&\-\s]+)/i);
  if (statusMatch?.[1]) {
    const parsedStatus = normalizeCrowdPulseStatus(statusMatch[1].split(',')[0] || statusMatch[1]);
    if (parsedStatus) {
      patch.status = parsedStatus;
    }
  }

  const clearRequested = shouldClearCrowdPulseQuestion(trimmedInstruction);
  const question = clearRequested ? undefined : extractQuestion(trimmedInstruction);
  if (question) {
    patch.activeQuestion = question;
  } else if (clearRequested) {
    patch.activeQuestion = '';
  }

  if (/prompt/i.test(trimmedInstruction) && !patch.activeQuestion) {
    const promptMatch = trimmedInstruction.match(/prompt(?:\s*(?:to|is|:|=))\s*(.+)$/i);
    if (promptMatch?.[1]) {
      patch.prompt = promptMatch[1].trim().slice(0, 180);
    }
  }

  if (Object.keys(patch).length === 0) {
    patch.prompt = trimmedInstruction.slice(0, 180);
  }

  return patch;
};
