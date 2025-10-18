const globalTimers = new Map<string, NodeJS.Timeout>();
const globalResolvers = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>();

export function debounceByKey(delayMs: number, namespace = 'default') {
  return (key: string, fn: () => Promise<void>) =>
    new Promise<void>((resolve, reject) => {
      const compositeKey = `${namespace}:${key}`;
      const existingTimer = globalTimers.get(compositeKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        const existingResolver = globalResolvers.get(compositeKey);
        if (existingResolver) {
          existingResolver.resolve();
          globalResolvers.delete(compositeKey);
        }
      }
      const timer = setTimeout(async () => {
        globalTimers.delete(compositeKey);
        globalResolvers.delete(compositeKey);
        try {
          await fn();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, delayMs);
      globalTimers.set(compositeKey, timer);
      globalResolvers.set(compositeKey, { resolve, reject });
    });
}

export function cancelDebounce(key: string, namespace = 'default') {
  const compositeKey = `${namespace}:${key}`;
  const timer = globalTimers.get(compositeKey);
  if (timer) {
    clearTimeout(timer);
    globalTimers.delete(compositeKey);
  }
  const resolver = globalResolvers.get(compositeKey);
  if (resolver) {
    resolver.resolve();
    globalResolvers.delete(compositeKey);
  }
}
