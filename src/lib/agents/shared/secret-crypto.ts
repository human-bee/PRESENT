import { BYOK_REQUIRED } from './byok-flags';

const ENCRYPTION_KEY_ENV = 'BYOK_ENCRYPTION_KEY_BASE64';
const IV_BYTES = 12;

function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('WEBCRYPTO_UNAVAILABLE');
  }
  return c;
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = (value || '').trim();
  if (!normalized) return new Uint8Array();

  // Node.js
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'));
  }

  // Edge / browser
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

let cachedKey: CryptoKey | null = null;
let cachedKeyB64: string | null = null;

async function importKey(keyB64: string): Promise<CryptoKey> {
  const normalized = keyB64.trim();
  if (cachedKey && cachedKeyB64 === normalized) return cachedKey;

  const raw = base64ToBytes(normalized);
  if (raw.length !== 32) {
    throw new Error('BYOK_ENCRYPTION_KEY_INVALID_LENGTH');
  }
  const rawKey = toWebCryptoBytes(raw);

  const crypto = getCrypto();
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);

  cachedKey = key;
  cachedKeyB64 = normalized;
  return key;
}

function readEncryptionKeyB64(): string {
  const raw = process.env[ENCRYPTION_KEY_ENV];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    if (BYOK_REQUIRED) {
      throw new Error('BYOK_ENCRYPTION_KEY_MISSING');
    }
    throw new Error('BYOK_ENCRYPTION_KEY_MISSING');
  }
  return value;
}

function aadFor(userId: string, provider: string): Uint8Array {
  return new TextEncoder().encode(`${userId}:${provider}`);
}

export type EncryptedSecret = {
  ciphertextB64: string;
  ivB64: string;
};

export async function encryptSecret(params: {
  userId: string;
  provider: string;
  plaintext: string;
}): Promise<EncryptedSecret> {
  const userId = params.userId.trim();
  const provider = params.provider.trim();
  const plaintext = params.plaintext.trim();
  if (!userId) throw new Error('BYOK_ENCRYPT_INVALID_USER');
  if (!provider) throw new Error('BYOK_ENCRYPT_INVALID_PROVIDER');
  if (!plaintext) throw new Error('BYOK_ENCRYPT_EMPTY');

  const crypto = getCrypto();
  const key = await importKey(readEncryptionKeyB64());
  const iv = toWebCryptoBytes(crypto.getRandomValues(new Uint8Array(IV_BYTES)));
  const data = toWebCryptoBytes(new TextEncoder().encode(plaintext));
  const additionalData = toWebCryptoBytes(aadFor(userId, provider));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    data,
  );

  return {
    ciphertextB64: bytesToBase64(new Uint8Array(encrypted)),
    ivB64: bytesToBase64(iv),
  };
}

export async function decryptSecret(params: {
  userId: string;
  provider: string;
  ciphertextB64: string;
  ivB64: string;
}): Promise<string> {
  const userId = params.userId.trim();
  const provider = params.provider.trim();
  if (!userId) throw new Error('BYOK_DECRYPT_INVALID_USER');
  if (!provider) throw new Error('BYOK_DECRYPT_INVALID_PROVIDER');

  const ciphertext = toWebCryptoBytes(base64ToBytes(params.ciphertextB64));
  const iv = toWebCryptoBytes(base64ToBytes(params.ivB64));
  if (iv.length !== IV_BYTES) {
    throw new Error('BYOK_DECRYPT_INVALID_IV');
  }

  const crypto = getCrypto();
  const key = await importKey(readEncryptionKeyB64());
  const additionalData = toWebCryptoBytes(aadFor(userId, provider));

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

export function last4(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}
