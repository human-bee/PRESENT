export type MergeableState<T> = T | null | undefined;

export function mergeState<T extends object>(
  prev: MergeableState<T>,
  next: Partial<T>,
  fallback: T,
): T {
  return { ...(prev ?? fallback), ...next };
}

export function produceState<T extends object>(
  prev: MergeableState<T>,
  producer: (base: T) => T,
  fallback: T,
): T {
  const base = prev ?? fallback;
  return producer(base);
}
