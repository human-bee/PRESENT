import type {Activity} from '../../shared/activity';
export type Effect = { type: 'extract' | 'research' | 'images' | 'data' | 'resolution'; id: string };
export function pendingEffects(a:Activity):Effect[]{
    return [
      ...a.utterances
        .filter((u) => u.epoch === a.epoch && u.extraction === 'pending')
        .slice(0, 1)
        .map((u) => ({ type: 'extract' as const, id: u.id })),
      ...a.resolutionSuggestions
        .filter((s) => s.source.epoch === a.epoch && s.status === 'pending')
        .map((s) => ({ type: 'resolution' as const, id: s.id })),
      ...a.visuals
        .filter((v) => v.epoch === a.epoch && v.status === 'pending')
        .map((v) => ({ type: 'images' as const, id: v.id })),
      ...a.claims
        .filter((c) => c.epoch === a.epoch && c.research.status === 'pending')
        .map((c) => ({ type: 'research' as const, id: c.id })),
      ...a.comparisons
        .filter((c) => c.source.epoch === a.epoch && c.status === 'pending')
        .map((c) => ({ type: 'data' as const, id: c.id })),
    ];
  }