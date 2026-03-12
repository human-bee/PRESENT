import {
  getCanvasModelDefinition,
  normalizeCanvasModelName,
  type CanvasModelProvider,
} from '@/lib/agents/subagents/canvas-models';

export const FAIRY_CANVAS_MODEL_STORAGE_KEY = 'present:fairy:canvas-model';

export const FAIRY_CANVAS_MODEL_OPTIONS = [
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    shortLabel: 'Balanced',
    description: 'Best balance of reliability and speed for live canvas work.',
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    shortLabel: 'Quality',
    description: 'Highest-quality lane when fidelity matters more than latency.',
  },
  {
    id: 'gpt-oss-120b',
    label: 'GPT OSS 120B',
    shortLabel: 'Speed',
    description: 'Fastest lane today, with lower structured-output reliability.',
  },
] as const;

export type FairyCanvasModelId = (typeof FAIRY_CANVAS_MODEL_OPTIONS)[number]['id'];

type StorageReader = Pick<Storage, 'getItem'> | null | undefined;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'> | null | undefined;

const FAIRY_CANVAS_MODEL_IDS = new Set(
  FAIRY_CANVAS_MODEL_OPTIONS.map((option) => option.id),
);

export function normalizeFairyCanvasModelId(raw: unknown): FairyCanvasModelId | null {
  const normalized = normalizeCanvasModelName(raw);
  return normalized && FAIRY_CANVAS_MODEL_IDS.has(normalized)
    ? (normalized as FairyCanvasModelId)
    : null;
}

export function getFairyCanvasModelOption(model: FairyCanvasModelId | null | undefined) {
  return FAIRY_CANVAS_MODEL_OPTIONS.find((option) => option.id === model) ?? null;
}

export function buildFairyCanvasModelRequest(
  model: FairyCanvasModelId | string | null | undefined,
): { model: FairyCanvasModelId; provider: CanvasModelProvider } | null {
  const normalized = normalizeFairyCanvasModelId(model);
  if (!normalized) return null;
  return {
    model: normalized,
    provider: getCanvasModelDefinition(normalized).provider,
  };
}

export function readStoredFairyCanvasModel(
  storage: StorageReader = typeof window !== 'undefined' ? window.localStorage : null,
): FairyCanvasModelId | null {
  try {
    return normalizeFairyCanvasModelId(storage?.getItem(FAIRY_CANVAS_MODEL_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeStoredFairyCanvasModel(
  value: FairyCanvasModelId | null,
  storage: StorageWriter = typeof window !== 'undefined' ? window.localStorage : null,
): FairyCanvasModelId | null {
  const normalized = normalizeFairyCanvasModelId(value);
  try {
    if (!normalized) {
      storage?.removeItem(FAIRY_CANVAS_MODEL_STORAGE_KEY);
      return null;
    }
    storage?.setItem(FAIRY_CANVAS_MODEL_STORAGE_KEY, normalized);
  } catch {}
  return normalized;
}
