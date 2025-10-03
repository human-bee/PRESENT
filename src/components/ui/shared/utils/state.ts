export function mergeState<T extends object>(prev: T | null | undefined, next: Partial<T>, initial: T): T {
  return { ...(prev ?? initial), ...next };
}

export function produceState<T extends object>(prev: T | null | undefined, producer: (draft: T) => void, initial: T): T {
  const base = { ...(prev ?? initial) } as T;
  producer(base);
  return base;
}
