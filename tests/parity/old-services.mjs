import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, openSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const old = process.env.PARITY_OLD_ROOT ?? '/Users/bsteinher/.codex/worktrees/present-room-zero-friction-clean';
const output = resolve(root, process.env.PARITY_OUTPUT ?? 'docs/evidence/parity-control');
const manifestPath = resolve(output, 'old-processes.json');
const expectedCommit = process.env.PARITY_OLD_COMMIT ?? '07fa2c583f6e751d4983bb5c30445b7536efb21e';
const action = process.argv[2];
mkdirSync(output, { recursive: true });

if (action === 'stop') {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const child of manifest.processes) {
    let command = '';
    let started = '';
    try {
      command = execFileSync('ps', ['-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' });
      started = execFileSync('ps', ['-p', String(child.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    } catch {}
    if (command.includes(child.entrypoint) || (started && started === child.processStartedAt)) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    } else if (command.trim()) {
      throw new Error(`PID ${child.pid} no longer matches the owned entrypoint; refusing to stop it.`);
    }
  }
  manifest.stopRequestedAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Requested shutdown of the exact recorded process groups.');
} else if (action === 'start') {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: old, encoding: 'utf8' }).trim();
  if (commit !== expectedCommit) throw new Error('Old baseline source changed.');
  const sourceDiff = execFileSync('git', ['diff', 'HEAD'], { cwd: old, encoding: 'utf8' });
  const allowedDiff = process.env.PARITY_OLD_PATCH ? readFileSync(resolve(root, process.env.PARITY_OLD_PATCH), 'utf8') : '';
  if (sourceDiff !== allowedDiff) throw new Error('Old source does not exactly match the declared bootstrap patch.');
  if (!existsSync(resolve(old, 'node_modules/next/dist/bin/next'))) throw new Error('Install the old lockfile first.');
  for (const port of [4320, 4321]) {
    await new Promise((done, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => server.close(done));
    });
  }
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_CANVAS_DEV_BYPASS: 'true', NEXT_PUBLIC_CANVAS_DEMO_MODE: 'false',
    NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED: 'false', NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED: 'false',
    NEXT_PUBLIC_LIVEKIT_AUTO_CONNECT: 'false', NEXT_PUBLIC_TLDRAW_SYNC_URL: 'http://127.0.0.1:4321',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4323', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'parity-no-database',
    LIVEKIT_URL: 'ws://127.0.0.1:4322', NEXT_PUBLIC_LIVEKIT_URL: 'ws://127.0.0.1:4322',
    NODE_OPTIONS: '--max-old-space-size=3072',
  };
  const definitions = [
    { name: 'sync', cwd: output, entrypoint: resolve(old, 'scripts/tldraw-sync-server/server.ts'),
      args: ['--require', resolve(root, 'tests/parity/loopback-only.cjs'), '--import', resolve(old, 'node_modules/tsx/dist/loader.mjs'), resolve(old, 'scripts/tldraw-sync-server/server.ts')], env: { ...env, TLDRAW_SYNC_PORT: '4321' } },
    { name: 'web', cwd: old, entrypoint: resolve(old, 'node_modules/next/dist/bin/next'),
      args: [resolve(old, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '4320'], env },
  ];
  const processes = definitions.map(definition => {
    const log = resolve(output, `${definition.name}.log`);
    const fd = openSync(log, 'a');
    const child = spawn(process.execPath, definition.args, { cwd: definition.cwd, env: definition.env, detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    const processStartedAt = execFileSync('ps', ['-p', String(child.pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    return { name: definition.name, pid: child.pid, processStartedAt, entrypoint: definition.entrypoint, log };
  });
  writeFileSync(manifestPath, `${JSON.stringify({ startedAt: new Date().toISOString(), old, commit, sourceDiff, isolation: 'Loopback only; no provider credentials, workers, LiveKit or database started.', ports: [4320, 4321], processes }, null, 2)}\n`);
  console.log(JSON.stringify({ manifestPath, processes }));
} else {
  throw new Error('Usage: node tests/parity/old-services.mjs start|stop');
}
