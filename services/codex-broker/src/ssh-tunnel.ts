import fs from 'node:fs/promises';
import net from 'node:net';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { Client } from 'ssh2';

export type CodexBrokerSshTunnelConfig = {
  host: string;
  port: number;
  username: string;
  remoteHost: string;
  remotePort: number;
  remoteProtocol: 'http' | 'https';
  hostKeySha256?: string | null;
  privateKeyPath?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  agentSocketPath?: string | null;
};

export type CodexBrokerSshTunnel = {
  targetBaseUrl: string;
  close: () => Promise<void>;
};

export const normalizeSha256Fingerprint = (value: string | null | undefined) =>
  value?.trim().replace(/^SHA256:/i, '').replace(/=+$/, '').trim() || '';

export const sha256FingerprintForHostKey = (hostKey: Buffer | string) => {
  const digest = crypto
    .createHash('sha256')
    .update(typeof hostKey === 'string' ? Buffer.from(hostKey, 'binary') : hostKey)
    .digest('base64');
  return normalizeSha256Fingerprint(digest);
};

export async function createCodexBrokerSshTunnel(
  config: CodexBrokerSshTunnelConfig,
): Promise<CodexBrokerSshTunnel> {
  const client = new Client();
  const expectedFingerprint = normalizeSha256Fingerprint(config.hostKeySha256);
  const privateKey =
    typeof config.privateKey === 'string' && config.privateKey.trim().length > 0
      ? config.privateKey
      : config.privateKeyPath
        ? await fs.readFile(config.privateKeyPath, 'utf8')
        : undefined;

  const readyPromise = once(client, 'ready');
  const errorPromise = once(client, 'error').then(([error]) => {
    throw error;
  });

  client.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    privateKey,
    passphrase: config.passphrase ?? undefined,
    agent: config.agentSocketPath ?? undefined,
    hostVerifier: (hostKey) => {
      if (!expectedFingerprint) {
        throw new Error(
          'CODEX_BROKER_SSH_HOST_KEY_SHA256 is required when CODEX_BROKER_DIRECT_TARGET_URL is not configured.',
        );
      }
      return sha256FingerprintForHostKey(hostKey) === expectedFingerprint;
    },
  });

  await Promise.race([readyPromise, errorPromise]);

  const localServer = net.createServer((socket) => {
    client.forwardOut(
      socket.remoteAddress || '127.0.0.1',
      socket.remotePort || 0,
      config.remoteHost,
      config.remotePort,
      (error, upstream) => {
        if (error || !upstream) {
          socket.destroy(error ?? new Error('Failed to create forwarded SSH stream.'));
          return;
        }
        socket.pipe(upstream);
        upstream.pipe(socket);

        const destroyBoth = () => {
          socket.destroy();
          upstream.destroy();
        };

        socket.on('error', destroyBoth);
        upstream.on('error', destroyBoth);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      localServer.off('error', reject);
      resolve();
    });
  });

  const address = localServer.address();
  if (!address || typeof address === 'string') {
    localServer.close();
    client.end();
    throw new Error('Failed to resolve local Codex broker tunnel address.');
  }

  return {
    targetBaseUrl: `${config.remoteProtocol}://127.0.0.1:${address.port}/`,
    close: async () => {
      await new Promise<void>((resolve) => {
        localServer.close(() => resolve());
      });
      client.end();
    },
  };
}
