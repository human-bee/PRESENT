import { kernelEventSchema, type KernelEvent } from '@present/contracts';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { readResetCollection, writeResetCollection } from './persistence';

export function createTraceId() {
  return createResetId(RESET_ID_PREFIXES.trace);
}

export function recordKernelEvent(input: Record<string, unknown>) {
  const event = kernelEventSchema.parse({
    ...input,
    id:
      typeof input.id === 'string' && input.id.trim().length > 0
        ? input.id
        : createResetId(RESET_ID_PREFIXES.event),
    emittedAt:
      typeof input.emittedAt === 'string' && input.emittedAt.trim().length > 0
        ? input.emittedAt
        : new Date().toISOString(),
  });
  writeResetCollection(
    'traces',
    [...readResetCollection('traces'), event].sort((left, right) => right.emittedAt.localeCompare(left.emittedAt)),
  );
  return event;
}

export function listTraceEvents(traceId?: string) {
  const traces = readResetCollection('traces');
  if (traceId) {
    return traces
      .filter((event) => event.traceId === traceId)
      .sort((left, right) => right.emittedAt.localeCompare(left.emittedAt));
  }
  return traces.sort((left, right) => right.emittedAt.localeCompare(left.emittedAt));
}

export function searchTraceEvents(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return listTraceEvents();
  return listTraceEvents().filter((event) => JSON.stringify(event).toLowerCase().includes(normalized));
}
