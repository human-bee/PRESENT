import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const TAILSCALE_SOCKET = process.env.TAILSCALE_SOCKET || '/tmp/present-railtail/tailscaled.sock';
const DEFAULT_STATE_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/railtail`
  : '/tmp/present-railtail/state';

type Target = {
  host: string;
  port: number;
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parsePort(name: string, value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be between 1 and 65535.`);
  }
  return port;
}

export function parseTargetAddress(value: string): Target {
  const trimmed = value.trim();
  const ipv6Match = trimmed.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return { host: ipv6Match[1] ?? '', port: parsePort('TARGET_ADDR port', ipv6Match[2] ?? '') };
  }

  const separator = trimmed.lastIndexOf(':');
  if (separator <= 0 || separator === trimmed.length - 1) {
    throw new Error('TARGET_ADDR must be formatted as host:port.');
  }
  const host = trimmed.slice(0, separator);
  const port = parsePort('TARGET_ADDR port', trimmed.slice(separator + 1));
  if (!host) {
    throw new Error('TARGET_ADDR host is required.');
  }
  return { host, port };
}

function spawnLogged(command: string, args: string[], options?: { redactArgs?: Set<string> }) {
  const printableArgs = args.map((arg) => (options?.redactArgs?.has(arg) ? '<redacted>' : arg));
  console.log(`[railtail] starting ${command} ${printableArgs.join(' ')}`);
  const child = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[railtail:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[railtail:${command}] ${chunk}`));
  return child;
}

async function runChecked(command: string, args: string[], options?: { redactArgs?: Set<string> }) {
  const child = spawnLogged(command, args, options);
  const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
  if (code !== 0) {
    throw new Error(`${command} exited with code ${code ?? 'signal'}.`);
  }
}

function startTailscaled(stateDir: string) {
  return spawnLogged('tailscaled', [
    `--socket=${TAILSCALE_SOCKET}`,
    '--tun=userspace-networking',
    `--statedir=${stateDir}`,
    '--socks5-server=127.0.0.1:1055',
    '--outbound-http-proxy-listen=127.0.0.1:1055',
  ]);
}

async function waitForTailscale() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const child = spawn('tailscale', ['--socket', TAILSCALE_SOCKET, 'status', '--json'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    if (code === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for tailscaled LocalAPI.');
}

function startTcpProxy(target: Target, listenPort: number) {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`;
    console.log(`[railtail] connection from ${remote} -> ${target.host}:${target.port}`);
    const child = spawn('tailscale', [
      '--socket',
      TAILSCALE_SOCKET,
      'nc',
      target.host,
      String(target.port),
    ]);

    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.stderr.on('data', (chunk) => process.stderr.write(`[railtail:nc] ${chunk}`));

    const close = () => {
      socket.destroy();
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    socket.on('error', close);
    socket.on('close', close);
    child.on('error', close);
    child.on('exit', close);
  });

  server.listen(listenPort, '0.0.0.0', () => {
    console.log(`[railtail] listening on 0.0.0.0:${listenPort} for ${target.host}:${target.port}`);
  });

  return server;
}

async function main() {
  const authKey = requireEnv('TS_AUTH_KEY');
  const target = parseTargetAddress(requireEnv('TARGET_ADDR'));
  const listenPort = parsePort('LISTEN_PORT', process.env.LISTEN_PORT?.trim() || process.env.PORT || '2222');
  const hostname = process.env.TS_HOSTNAME?.trim() || 'present-railtail';
  const stateDir = process.env.TS_STATEDIR_PATH?.trim() || DEFAULT_STATE_DIR;
  fs.mkdirSync(path.dirname(TAILSCALE_SOCKET), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const tailscaled = startTailscaled(stateDir);
  tailscaled.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[railtail] tailscaled exited with code ${code}`);
      process.exit(code);
    }
    if (signal) {
      console.error(`[railtail] tailscaled exited from signal ${signal}`);
      process.exit(1);
    }
  });

  await waitForTailscale();

  const upArgs = [
    '--socket',
    TAILSCALE_SOCKET,
    'up',
    `--auth-key=${authKey}`,
    `--hostname=${hostname}`,
    '--accept-dns=true',
    ...(process.env.TS_EXTRA_ARGS?.trim().split(/\s+/).filter(Boolean) ?? []),
  ];
  await runChecked('tailscale', upArgs, { redactArgs: new Set([`--auth-key=${authKey}`]) });

  const server = startTcpProxy(target, listenPort);

  const shutdown = () => {
    console.log('[railtail] shutting down');
    server.close();
    tailscaled.kill('SIGTERM');
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(`[railtail] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
