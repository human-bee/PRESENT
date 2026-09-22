import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const savedPath = resolve(root, '.data/runtime/preview.json');
const saved = existsSync(savedPath) ? JSON.parse(readFileSync(savedPath, 'utf8')) : {};
const runtime = process.env.PRESENT_PREVIEW_ROOT ? resolve(process.env.PRESENT_PREVIEW_ROOT) : saved.runtime ?? root;
if (runtime !== root && !runtime.startsWith(resolve(root, '.data/runtime') + '/')) throw new Error('Preview runtime must be owned by this worktree.');
const dataDirectory = process.env.PRESENT_DATA_DIRECTORY ?? saved.dataDirectory;
const label = 'local.present.roomos-preview';
const target = `gui/${process.getuid()}/${label}`;
const plist = resolve(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const logs = resolve(root, '.data/runtime');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const inspect = () => spawnSync('/bin/launchctl', ['print', target], { encoding: 'utf8' });
const action = process.argv[2] ?? 'status';
if (process.platform !== 'darwin') throw new Error('The owned preview lifecycle currently uses macOS launchd.');
if (existsSync(plist) && !readFileSync(plist, 'utf8').includes(escape(root))) throw new Error('This launchd label belongs to a different checkout. Preserve it and choose a separate label.');
if (action === 'stop') {
  if (inspect().status === 0) execFileSync('/bin/launchctl', ['bootout', target]);
  console.log(`Stopped ${label}. Saved room data and logs remain in ${logs}.`);
} else if (action === 'start' || action === 'restart') {
  if (!existsSync(resolve(runtime, 'dist/index.html'))) throw new Error('Run npm run build in the isolated worktree first.');
  mkdirSync(dirname(plist), { recursive: true }); mkdirSync(logs, { recursive: true, mode: 0o700 });
  writeFileSync(savedPath, JSON.stringify({ runtime, ...(dataDirectory ? { dataDirectory } : {}) }), { mode: 0o600 });
  const envFile = process.env.PRESENT_ENV_FILE ?? resolve(homedir(), 'PRESENT/.env.local');
  if (!existsSync(envFile)) throw new Error('Set PRESENT_ENV_FILE to the configured environment file.');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>WorkingDirectory</key><string>${escape(runtime)}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>--import</string><string>tsx</string><string>server/index.ts</string></array>
<key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string><key>PRESENT_PORT</key><string>4318</string>${dataDirectory ? `<key>PRESENT_DATA_DIRECTORY</key><string>${escape(dataDirectory)}</string>` : ''}<key>PRESENT_ENV_FILE</key><string>${escape(envFile)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>${escape(logs)}/preview.stdout.log</string><key>StandardErrorPath</key><string>${escape(logs)}/preview.stderr.log</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
</dict></plist>`;
  writeFileSync(plist, xml, { mode: 0o600 });
  if (action === 'restart' && inspect().status === 0) {
    execFileSync('/bin/launchctl', ['bootout', target]);
    const deadline = Date.now() + 8000;
    while (inspect().status === 0) { if (Date.now() > deadline) throw new Error('The old preview is still stopping; retry start after it exits.'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (inspect().status !== 0) execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  console.log(`launchd owns ${target}; this command can exit. Runtime: ${runtime}. URL: http://127.0.0.1:4318. Logs: ${logs}`);
} else if (action === 'status') {
  const result = inspect();
  console.log({ service: target, runtime, dataDirectory, loaded: result.status === 0, status: result.stdout.split('\n').filter(line => /^\s*(state|pid|last exit code|runs) =/.test(line)).map(line => line.trim()), url: 'http://127.0.0.1:4318', logs });
  try { const response = await fetch('http://127.0.0.1:4318/api/health', { signal: AbortSignal.timeout(3000) }); console.log({ http: response.status, health: await response.json() }); }
  catch { console.log({ reachable: false }); process.exitCode = 1; }
} else throw new Error('Use start, restart, stop or status.');
