import { dataPath } from '../data-path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A private signing key, not a second activity store. Canvas edits cannot mint work authorization. */
export class ActivityAuthority {
  private key?: Buffer;
  constructor(
    private directory = dataPath(),
    private suppliedKey?: Buffer,
  ) {}
  private secret() {
    if (this.suppliedKey) return this.suppliedKey;
    if (this.key) return this.key;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'activity-authority.key');
    if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error('Activity authorization key is unavailable.');
    this.key = key;
    return key;
  }
  sign(value: unknown) {
    const canonical = (input: unknown): unknown =>
      Array.isArray(input)
        ? input.map(canonical)
        : input && typeof input === 'object'
          ? Object.fromEntries(
              Object.entries(input)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, child]) => [key, canonical(child)]),
            )
          : input;
    return createHmac('sha256', this.secret())
      .update(JSON.stringify(canonical(value)))
      .digest('hex');
  }
  verify(value: unknown, proof: string) {
    if (!/^[a-f0-9]{64}$/.test(proof)) return false;
    return timingSafeEqual(Buffer.from(this.sign(value), 'hex'), Buffer.from(proof, 'hex'));
  }
}
