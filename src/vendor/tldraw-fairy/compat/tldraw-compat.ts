import type { RecordsDiff, TLShape } from 'tldraw';
import type { UnknownRecord } from '@tldraw/store';
import { b64Vecs } from './b64Vecs';

export { b64Vecs };

export function assertExists<T>(value: T, message?: string): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined');
  }
  return value as NonNullable<T>;
}

export function last<T>(arr: readonly T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!globalThis.fetch) {
    throw new Error('Fetch is not available in this environment.');
  }
  return globalThis.fetch(input, init);
}

export type ExtractShapeByProps<P> = Extract<TLShape, { props: P }>;

export function createEmptyRecordsDiff<R extends UnknownRecord>(): RecordsDiff<R> {
  return { added: {}, updated: {}, removed: {} } as RecordsDiff<R>;
}

export function getFromLocalStorage(key: string, fallback: string = ''): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function setInLocalStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}
