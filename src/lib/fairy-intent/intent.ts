import { z } from 'zod';
import { jsonObjectSchema } from '@/lib/utils/json-schema';
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
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    componentId: z.string().optional(),
    contextProfile: z.enum(FAIRY_CONTEXT_PROFILES).optional(),
    spectrum: z.number().min(0).max(1).optional(),
    model: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    billingUserId: z.string().min(1).optional(),
    requesterUserId: z.string().min(1).optional(),
    sharedUnlockSessionId: z.string().min(1).optional(),
    modelKeySource: z.string().min(1).optional(),
    primaryModelKeySource: z.string().min(1).optional(),
    fastModelKeySource: z.string().min(1).optional(),
    canvasConfigOverrides: jsonObjectSchema.optional(),
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
    model: raw.model?.trim() || undefined,
    provider: raw.provider?.trim() || undefined,
    billingUserId: raw.billingUserId?.trim() || undefined,
    requesterUserId: raw.requesterUserId?.trim() || undefined,
    sharedUnlockSessionId: raw.sharedUnlockSessionId?.trim() || undefined,
    modelKeySource: raw.modelKeySource?.trim() || undefined,
    primaryModelKeySource: raw.primaryModelKeySource?.trim() || undefined,
    fastModelKeySource: raw.fastModelKeySource?.trim() || undefined,
    canvasConfigOverrides:
      raw.canvasConfigOverrides && typeof raw.canvasConfigOverrides === 'object'
        ? raw.canvasConfigOverrides
        : undefined,
  };
}
