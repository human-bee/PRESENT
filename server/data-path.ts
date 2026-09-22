import { resolve } from 'node:path';

/** Separate test/preview runtimes must not own the same native rooms or work queue. */
export function dataPath(...parts: string[]): string {
  return resolve(process.env.PRESENT_DATA_DIRECTORY ?? resolve(process.cwd(), '.data'), ...parts);
}
