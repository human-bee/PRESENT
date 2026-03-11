import { z } from 'zod';

export const voiceTurnModeSchema = z.enum(['auto', 'manual']);

export type VoiceTurnMode = z.infer<typeof voiceTurnModeSchema>;

export const voiceControlMessageSchema = z.object({
  type: z.literal('turn_mode'),
  mode: voiceTurnModeSchema,
  participantId: z.string().trim().min(1).optional(),
  roomId: z.string().trim().min(1).optional(),
  timestamp: z.number().int(),
});

export type VoiceControlMessage = z.infer<typeof voiceControlMessageSchema>;

function normalizeParticipantId(participantId?: string | null): string | null {
  if (typeof participantId !== 'string') return null;
  const trimmed = participantId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createVoiceControlMessage(input: {
  mode: VoiceTurnMode;
  participantId?: string | null;
  roomId?: string | null;
  timestamp?: number;
}): VoiceControlMessage {
  return {
    type: 'turn_mode',
    mode: input.mode,
    ...(input.participantId?.trim() ? { participantId: input.participantId.trim() } : {}),
    ...(input.roomId?.trim() ? { roomId: input.roomId.trim() } : {}),
    timestamp: Number.isFinite(input.timestamp)
      ? Math.round(input.timestamp as number)
      : Date.now(),
  };
}

export function parseVoiceControlMessage(input: unknown): VoiceControlMessage | null {
  const parsed = voiceControlMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function resolveVoiceTurnModeForParticipant(
  modesByParticipant: ReadonlyMap<string, VoiceTurnMode>,
  input: {
    participantId?: string | null;
    fallbackParticipantIds?: Iterable<string | null | undefined>;
  },
): VoiceTurnMode {
  const participantId = normalizeParticipantId(input.participantId);
  if (participantId) {
    return modesByParticipant.get(participantId) ?? 'auto';
  }

  const fallbackParticipantIds = Array.from(input.fallbackParticipantIds ?? [])
    .map((value) => normalizeParticipantId(value))
    .filter((value): value is string => Boolean(value));

  if (fallbackParticipantIds.length !== 1) {
    return 'auto';
  }

  return modesByParticipant.get(fallbackParticipantIds[0]) ?? 'auto';
}

export function shouldSuppressAutomaticTurn(mode: VoiceTurnMode, isManual: boolean): boolean {
  return mode === 'manual' && !isManual;
}
