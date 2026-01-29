import { z } from 'zod';
import { FAIRY_CONTEXT_PROFILES, normalizeFairyContextProfile } from '@/lib/fairy-context/profiles';

export const FairyBoundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })
  .strict();

export const FairyIntentSchema = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1),
    message: z.string().min(1),
    source: z.enum(['voice', 'fairy', 'ui', 'transcript', 'system']),
    timestamp: z.number().optional(),
    selectionIds: z.array(z.string()).optional(),
    bounds: FairyBoundsSchema.optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    componentId: z.string().optional(),
    contextProfile: z.enum(FAIRY_CONTEXT_PROFILES).optional(),
    spectrum: z.number().min(0).max(1).optional(),
  })
  .strict();

export type FairyIntent = z.infer<typeof FairyIntentSchema>;

export function normalizeFairyIntent(raw: FairyIntent): FairyIntent {
  return {
    ...raw,
    id: raw.id.trim(),
    room: raw.room.trim(),
    message: raw.message.trim(),
    selectionIds: Array.isArray(raw.selectionIds) ? raw.selectionIds.map((id) => id.trim()) : undefined,
    componentId: raw.componentId?.trim() || undefined,
    contextProfile: normalizeFairyContextProfile(raw.contextProfile),
    spectrum: typeof raw.spectrum === 'number' && Number.isFinite(raw.spectrum) ? raw.spectrum : undefined,
  };
}
