/**
 * @jest-environment node
 */

import { decryptSecret, encryptSecret } from './secret-crypto';

describe('secret-crypto', () => {
  const originalKey = process.env.BYOK_ENCRYPTION_KEY_BASE64;

  beforeAll(() => {
    // 32 bytes base64-encoded: deterministic test key (do not use in production)
    process.env.BYOK_ENCRYPTION_KEY_BASE64 = Buffer.from(
      Array.from({ length: 32 }, (_, i) => i),
    ).toString('base64');
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.BYOK_ENCRYPTION_KEY_BASE64;
    } else {
      process.env.BYOK_ENCRYPTION_KEY_BASE64 = originalKey;
    }
  });

  it('round-trips plaintext', async () => {
    const enc = await encryptSecret({ userId: 'user-1', provider: 'openai', plaintext: 'sk-test-1234' });
    const dec = await decryptSecret({
      userId: 'user-1',
      provider: 'openai',
      ciphertextB64: enc.ciphertextB64,
      ivB64: enc.ivB64,
    });
    expect(dec).toBe('sk-test-1234');
  });

  it('fails when AAD does not match', async () => {
    const enc = await encryptSecret({ userId: 'user-1', provider: 'openai', plaintext: 'sk-test-1234' });
    await expect(
      decryptSecret({
        userId: 'user-2',
        provider: 'openai',
        ciphertextB64: enc.ciphertextB64,
        ivB64: enc.ivB64,
      }),
    ).rejects.toBeTruthy();
  });
});
