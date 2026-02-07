import type { JsonObject } from '@/lib/utils/json-schema';

export type IntentResolution = { kind: 'task'; task: string; params?: JsonObject };

const ALLOWED_TASK_PREFIXES = ['canvas.', 'flowchart.', 'scorecard.', 'search.', 'fairy.', 'conductor.'];

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

function extractExplicitTask(input: JsonObject): string | undefined {
  const task = getString(input, 'task');
  if (task) return task;
  const metadata = getObject(input, 'metadata');
  if (metadata) {
    const metaTask = getString(metadata, 'task');
    if (metaTask) return metaTask;
  }
  return undefined;
}

function isAllowedTask(task: string): boolean {
  const lowered = task.toLowerCase();
  return ALLOWED_TASK_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

export function resolveIntent(input: JsonObject): IntentResolution | null {
  const explicitTask = extractExplicitTask(input);
  if (!explicitTask || explicitTask === 'auto') {
    return null;
  }

  if (!isAllowedTask(explicitTask)) {
    return null;
  }

  const explicitParams = getObject(input, 'params');
  return {
    kind: 'task',
    task: explicitTask,
    params: explicitParams ? { ...explicitParams } : undefined,
  };
}
