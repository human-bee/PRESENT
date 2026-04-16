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

export type ListTraceEventsOptions = {
  traceId?: string;
  workspaceSessionId?: string;
  emittedAfterOrAt?: string | null;
  limit?: number;
  order?: 'asc' | 'desc';
  query?: string;
};

const resolveTraceListOptions = (input?: string | ListTraceEventsOptions): ListTraceEventsOptions => {
  if (typeof input === 'string') {
    return { traceId: input };
  }
  return input ?? {};
};

export function listTraceEvents(input?: string | ListTraceEventsOptions) {
  const options = resolveTraceListOptions(input);
  const normalizedQuery = options.query?.trim().toLowerCase() ?? '';
  let traces = readResetCollection('traces');

  if (options.traceId) {
    traces = traces.filter((event) => event.traceId === options.traceId);
  }

  if (options.workspaceSessionId) {
    traces = traces.filter((event) => event.workspaceSessionId === options.workspaceSessionId);
  }

  if (options.emittedAfterOrAt) {
    traces = traces.filter((event) => event.emittedAt >= options.emittedAfterOrAt!);
  }

  if (normalizedQuery) {
    traces = traces.filter((event) => JSON.stringify(event).toLowerCase().includes(normalizedQuery));
  }

  const orderedTraces = options.order === 'asc' ? [...traces].reverse() : traces;
  if (options.order === 'asc') {
    return typeof options.limit === 'number' && options.limit > 0
      ? orderedTraces.slice(0, options.limit)
      : orderedTraces;
  }

  return typeof options.limit === 'number' && options.limit > 0
    ? orderedTraces.slice(0, options.limit)
    : orderedTraces;
}

export function searchTraceEvents(query: string, options?: Omit<ListTraceEventsOptions, 'query'>) {
  const normalized = query.trim();
  if (!normalized) return listTraceEvents(options);
  return listTraceEvents({
    ...options,
    query: normalized,
  });
}
