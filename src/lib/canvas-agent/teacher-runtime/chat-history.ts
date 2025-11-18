import type { ChatHistoryPart } from '../../../../vendor/tldraw-agent-template/shared/parts/ChatHistoryPartUtil';
import type { ChatHistoryItem } from '../../../../vendor/tldraw-agent-template/shared/types/ChatHistoryItem';

export type TranscriptEntry = {
  participantId?: string;
  speaker?: string;
  role?: string;
  text?: string;
  timestamp?: number;
};

const DEFAULT_MAX_HISTORY = 24;
const AGENT_SPEAKER_PATTERN = /(agent|steward|present)/i;

const isMeaningfulText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const resolveSpeakerLabel = (entry: TranscriptEntry) => {
  const candidate = isMeaningfulText(entry.participantId)
    ? entry.participantId
    : isMeaningfulText(entry.speaker)
      ? entry.speaker
      : isMeaningfulText(entry.role)
        ? entry.role
        : '';
  return candidate.trim();
};

const shouldSkipSpeaker = (label: string) => label.length > 0 && AGENT_SPEAKER_PATTERN.test(label.toLowerCase());

export function buildTeacherChatHistory(options: {
  transcript?: TranscriptEntry[] | null;
  maxEntries?: number;
}): ChatHistoryPart['items'] {
  const rawEntries = Array.isArray(options.transcript) ? options.transcript : [];
  if (rawEntries.length === 0) return null;

  const maxEntries = Number.isFinite(options.maxEntries)
    ? Math.max(1, Math.min(40, Math.floor(options.maxEntries as number)))
    : DEFAULT_MAX_HISTORY;

  const pruned = rawEntries
    .filter((entry) => entry && isMeaningfulText(entry.text))
    .slice(-maxEntries);

  const items: ChatHistoryItem[] = [];

  for (const entry of pruned) {
    const text = (entry.text ?? '').trim();
    if (!text) continue;

    const speakerLabel = resolveSpeakerLabel(entry);
    if (shouldSkipSpeaker(speakerLabel)) continue;

    const prefix = speakerLabel && !/^user$/i.test(speakerLabel) ? `${speakerLabel}: ` : '';
    items.push({
      type: 'prompt',
      message: `${prefix}${text}`,
      contextItems: [],
      selectedShapes: [],
    });
  }

  return items.length > 0 ? items : null;
}
