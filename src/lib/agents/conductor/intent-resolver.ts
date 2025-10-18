import type { JsonObject } from '@/lib/utils/json-schema';

export type IntentResolution =
  | { kind: 'tool_call'; tool: string; params?: JsonObject }
  | { kind: 'task'; task: string; params?: JsonObject };

const DEFAULT_TIMER_MINUTES = 5;
const MAX_TIMER_MINUTES = 720;
const DEFAULT_FLOWCHART_DOC_ID = 'main';

const TIMER_KEYWORDS = ['timer', 'countdown', 'stopwatch', 'alarm', 'clock'];
const KANBAN_KEYWORDS = ['kanban', 'linear', 'issue board', 'project board', 'task board'];
const FLOWCHART_KEYWORDS = ['flowchart', 'flow chart', 'flow diagram', 'process flow', 'swimlane', 'swim lane', 'mermaid'];
const DOCUMENT_KEYWORDS = ['document', 'doc', 'notes', 'note', 'notepad', 'scratch'];
const TOOLBOX_KEYWORDS = ['toolbox', 'component toolbox', 'component list', 'palette'];
const YOUTUBE_KEYWORDS = ['youtube', 'video', 'watch', 'play'];

const YOUTUBE_ID_REGEX = /\b([A-Za-z0-9_-]{11})\b/;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getObject(input: JsonObject, key: string): JsonObject | undefined {
  const value = input[key];
  return isRecord(value) ? (value as JsonObject) : undefined;
}

export function getString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseMinutesFromText(text: string): number | undefined {
  const digitMatch = text.match(/\b(\d{1,3})\s*(?:minutes?|mins?|min|m)\b/);
  if (digitMatch) {
    const minutes = Number.parseInt(digitMatch[1] ?? '', 10);
    if (!Number.isNaN(minutes)) {
      return minutes;
    }
  }
  const hourMatch = text.match(/\b(\d{1,2})\s*(?:hours?|hrs?|h)\b/);
  if (hourMatch) {
    const hours = Number.parseInt(hourMatch[1] ?? '', 10);
    if (!Number.isNaN(hours)) {
      return hours * 60;
    }
  }
  return undefined;
}

function mergeInput(input: JsonObject): JsonObject {
  const merged: JsonObject = { ...input };
  delete merged.task;
  const nested = getObject(input, 'params');
  if (nested) {
    Object.entries(nested).forEach(([key, value]) => {
      if (!(key in merged)) {
        merged[key] = value;
      }
    });
  }
  const metadata = getObject(input, 'metadata');
  if (metadata && !isRecord(merged.metadata ?? null)) {
    merged.metadata = metadata;
  }
  delete merged.params;
  return merged;
}

function extractExplicitTask(input: JsonObject): string | undefined {
  const task = getString(input, 'task');
  if (task) {
    return task;
  }
  const metadata = getObject(input, 'metadata');
  if (metadata) {
    const metaTask = getString(metadata, 'task');
    if (metaTask) {
      return metaTask;
    }
  }
  return undefined;
}

function valueToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const joined = value.join(' ').trim();
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}

function extractText(input: JsonObject): string {
  const metadata = getObject(input, 'metadata');
  const candidates = [
    valueToString(input.transcript),
    valueToString(input.message),
    metadata ? valueToString(metadata.message) : undefined,
    valueToString(input.intent),
    valueToString(input.prompt),
    metadata ? valueToString(metadata.prompt) : undefined,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

export function resolveIntent(input: JsonObject): IntentResolution | null {
  const explicitTask = extractExplicitTask(input);
  if (explicitTask && explicitTask !== 'auto') {
    const explicitParams = getObject(input, 'params');
    return {
      kind: 'task',
      task: explicitTask,
      params: explicitParams ? { ...explicitParams } : undefined,
    };
  }

  const merged = mergeInput(input);
  const text = extractText(merged);
  if (!text) {
    const metadataTask = merged.metadata && typeof merged.metadata === 'object' ? getString(merged.metadata as JsonObject, 'task') : undefined;
    if (metadataTask && metadataTask.startsWith('canvas.')) {
      const message = getString(merged.metadata as JsonObject, 'message') ?? getString(merged, 'message');
      return {
        kind: 'task',
        task: metadataTask,
        params: message ? { message } : undefined,
      };
    }
    return null;
  }

  const lower = text.toLowerCase();

  if (includesAny(lower, FLOWCHART_KEYWORDS)) {
    const params: JsonObject = {
      docId: DEFAULT_FLOWCHART_DOC_ID,
      transcript: text,
    };
    return { kind: 'task', task: 'flowchart.create', params };
  }

  if (includesAny(lower, TIMER_KEYWORDS)) {
    const minutes = clamp(parseMinutesFromText(lower) ?? DEFAULT_TIMER_MINUTES, 1, MAX_TIMER_MINUTES);
    const params: JsonObject = {
      type: 'RetroTimerEnhanced',
      spec: JSON.stringify({ initialMinutes: minutes, autoStart: false }),
    };
    return { kind: 'tool_call', tool: 'create_component', params };
  }

  if (includesAny(lower, KANBAN_KEYWORDS)) {
    const params: JsonObject = {
      type: 'LinearKanbanBoard',
      spec: '{}',
    };
    return { kind: 'tool_call', tool: 'create_component', params };
  }

  if (includesAny(lower, DOCUMENT_KEYWORDS)) {
    const params: JsonObject = {
      type: 'DocumentEditor',
      spec: '{}',
    };
    return { kind: 'tool_call', tool: 'create_component', params };
  }

  if (includesAny(lower, TOOLBOX_KEYWORDS)) {
    const params: JsonObject = {
      type: 'ComponentToolbox',
      spec: '{}',
    };
    return { kind: 'tool_call', tool: 'create_component', params };
  }

  if (includesAny(lower, YOUTUBE_KEYWORDS)) {
    const idMatch = text.match(YOUTUBE_ID_REGEX);
    if (idMatch) {
      const params: JsonObject = {
        type: 'YoutubeEmbed',
        spec: JSON.stringify({ videoId: idMatch[1] }),
      };
      return { kind: 'tool_call', tool: 'create_component', params };
    }
    const params: JsonObject = { query: text };
    return { kind: 'tool_call', tool: 'youtube_search', params };
  }

  return null;
}


