import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The managed preview forwards Vite's standard CLI flags. Keep ordinary local
// development on loopback; a shared preview uses the signed invitation profile.
const args = process.argv.slice(2);
const env = { ...process.env };
if (args.length) {
  if (args.join(' ') !== '--host 0.0.0.0 --port 4173 --strictPort') throw new Error('Unsupported development server arguments.');
  if (process.env.NODE_ENV === 'production') throw new Error('Development preview cannot serve production.');
  const directory = resolve('.data/managed-preview');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const secretPath = resolve(directory, 'session-secret');
  let secret;
  try { secret = readFileSync(secretPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    secret = randomBytes(32).toString('hex');
    writeFileSync(secretPath, secret, { mode: 0o600, flag: 'wx' });
  }
  Object.assign(env, {
    PRESENT_MANAGED_PREVIEW: '1', PRESENT_HOST: '0.0.0.0', PRESENT_PORT: '4173',
    PRESENT_ACCESS_MODE: 'invite', PRESENT_ACCESS_ORIGIN: 'http://terminal.local:4173',
    PRESENT_ACCESS_SECRET: secret, PRESENT_ACCESS_DIRECTORY: resolve(directory, 'access'),
    PRESENT_DATA_DIRECTORY: directory,
  });
}
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: 'inherit', env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
