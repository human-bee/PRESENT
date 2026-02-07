import type { MemoryHit, MemoryRecallState } from './memory-recall-schema';

export const normalizeMemoryRecallState = (input: Partial<MemoryRecallState>): MemoryRecallState => ({
  title: input.title?.trim() || 'Memory Recall',
  query: input.query?.trim() || '',
  results: Array.isArray(input.results) ? (input.results as MemoryHit[]) : [],
  toolName: input.toolName,
  memoryCollection: input.memoryCollection,
  memoryIndex: input.memoryIndex,
  memoryNamespace: input.memoryNamespace,
  autoSearch: input.autoSearch,
  lastUpdated: input.lastUpdated,
});

const toText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.information === 'string') return obj.information;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.content)) {
      const parts = obj.content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean);
      if (parts.length) return parts.join('\n');
    }
  }
  return '';
};

const toMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (obj.metadata && typeof obj.metadata === 'object') return obj.metadata as Record<string, unknown>;
  if (obj.payload && typeof obj.payload === 'object') return obj.payload as Record<string, unknown>;
  return undefined;
};

const toScore = (value: unknown): number | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const score = obj.score ?? obj.similarity ?? obj.distance;
  return typeof score === 'number' && Number.isFinite(score) ? score : undefined;
};

const toId = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const id = obj.id ?? obj.point_id ?? obj.uuid;
  return typeof id === 'string' ? id : typeof id === 'number' ? String(id) : undefined;
};

export const normalizeMemoryRecallResults = (raw: unknown): MemoryHit[] => {
  const fallback = (item: unknown): MemoryHit[] => {
    const text = toText(item) || JSON.stringify(item);
    if (!text) return [];
    return [{ text, metadata: toMetadata(item), score: toScore(item), id: toId(item), raw: item }];
  };

  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => fallback(item));

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const listKeys = ['results', 'matches', 'points', 'data', 'items', 'documents', 'messages'];
    for (const key of listKeys) {
      const value = obj[key];
      if (Array.isArray(value)) return value.flatMap((item) => fallback(item));
    }
    return fallback(obj);
  }

  return fallback(raw);
};
