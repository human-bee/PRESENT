#!/usr/bin/env node
/**
 * One-time local helper: generate and persist BYOK_ENCRYPTION_KEY_BASE64 in .env.local.
 *
 * - Generates a base64-encoded 32-byte key (AES-256-GCM).
 * - Writes it to .env.local only if missing.
 * - Never prints the key to stdout/stderr (so it doesn't end up in logs).
 *
 * This is only for local/dev convenience. For production, set the env var in your host/secret manager.
 */

import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const ENV_VAR = 'BYOK_ENCRYPTION_KEY_BASE64';

function hasVar(contents) {
  const re = new RegExp(`^\\s*${ENV_VAR}\\s*=`, 'm');
  return re.test(contents);
}

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}

function main() {
  const envPath = path.join(process.cwd(), '.env.local');
  let existing = '';
  try {
    existing = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  if (existing && hasVar(existing)) {
    process.stdout.write(`[byok] ${ENV_VAR} already present in .env.local\n`);
    return;
  }

  const keyB64 = randomBytes(32).toString('base64');

  const header =
    '\n# Bring Your Own Keys (BYOK)\n' +
    '# Base64-encoded 32-byte key used to encrypt per-user provider keys stored in Supabase.\n' +
    '# Keep this stable; rotating it will require users to re-enter keys.\n';

  const line = `${ENV_VAR}=${keyB64}\n`;

  const next = ensureTrailingNewline(existing || '') + header + line;
  fs.writeFileSync(envPath, next, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`[byok] Wrote ${ENV_VAR} to .env.local (not printed)\n`);
}

main();

