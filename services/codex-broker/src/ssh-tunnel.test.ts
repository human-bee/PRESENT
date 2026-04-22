/** @jest-environment node */

const {
  normalizeSha256Fingerprint,
  sha256FingerprintForHostKey,
} = require('./ssh-tunnel') as typeof import('./ssh-tunnel');

describe('Codex broker SSH host key fingerprints', () => {
  it('normalizes OpenSSH SHA256 fingerprints', () => {
    expect(normalizeSha256Fingerprint('SHA256:abc123=')).toBe('abc123');
    expect(normalizeSha256Fingerprint(' abc123 ')).toBe('abc123');
  });

  it('computes OpenSSH-compatible base64 SHA256 fingerprints from raw host keys', () => {
    const key = Buffer.from('test host key bytes');
    expect(`SHA256:${sha256FingerprintForHostKey(key)}`).toBe(
      'SHA256:i8RAo8FepaZh9Zk1g11kAg4bPC81Xk9YFVtnzGVO4co',
    );
  });
});
