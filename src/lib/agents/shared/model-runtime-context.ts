import { AsyncLocalStorage } from 'node:async_hooks';

type RuntimeModelKeyBag = {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
};

const runtimeModelStorage = new AsyncLocalStorage<RuntimeModelKeyBag>();

export async function withRuntimeModelKeys<T>(
  keys: RuntimeModelKeyBag,
  run: () => Promise<T>,
): Promise<T> {
  return runtimeModelStorage.run(keys, run);
}

export function getRuntimeModelKey(name: keyof RuntimeModelKeyBag): string | undefined {
  const store = runtimeModelStorage.getStore();
  if (!store) return undefined;
  const value = store[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
