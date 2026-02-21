import { describe, expect, it } from '@jest/globals';
import {
  areWorkerHostsEquivalent,
  extractRuntimeScopeFromParams,
  getRuntimeScopeResourceKey,
  getWorkerHostSkipResourceKey,
  hasRuntimeScopeMismatch,
  isLocalRuntimeScope,
  normalizeWorkerHostIdentity,
  normalizeRuntimeScope,
  resolveRuntimeScopeFromEnv,
} from './runtime-scope';

describe('runtime-scope', () => {
  it('normalizes livekit-style urls into host:port', () => {
    expect(normalizeRuntimeScope('wss://present.best:7880')).toBe('present.best:7880');
    expect(normalizeRuntimeScope('ws://localhost:7880')).toBe('localhost:7880');
    expect(normalizeRuntimeScope('https://example.com')).toBe('example.com');
    expect(normalizeRuntimeScope('example.com:4444/path')).toBe('example.com:4444');
  });

  it('resolves runtime scope from env precedence', () => {
    const resolved = resolveRuntimeScopeFromEnv({
      AGENT_RUNTIME_SCOPE: '',
      LIVEKIT_REST_URL: 'https://lk-a.example.com:7880',
      LIVEKIT_URL: 'wss://lk-b.example.com:7880',
    });
    expect(resolved).toBe('lk-a.example.com:7880');
  });

  it('extracts runtime scope from params and metadata', () => {
    expect(
      extractRuntimeScopeFromParams({
        runtimeScope: 'wss://lk-direct.example.com:7880',
      } as any),
    ).toBe('lk-direct.example.com:7880');

    expect(
      extractRuntimeScopeFromParams({
        metadata: { runtimeScope: 'ws://lk-meta.example.com:7880' },
      } as any),
    ).toBe('lk-meta.example.com:7880');
  });

  it('builds stable resource keys', () => {
    expect(getRuntimeScopeResourceKey('wss://present.best:7880')).toBe('runtime-scope:present.best:7880');
    expect(getWorkerHostSkipResourceKey('Bens-MBP.local')).toBe('skip-host:bens-mbp');
  });

  it('normalizes and compares worker host aliases', () => {
    expect(normalizeWorkerHostIdentity('Bens-MBP.local')).toBe('bens-mbp');
    expect(normalizeWorkerHostIdentity('HTTPS://Bens-MBP.local:3000')).toBe('bens-mbp');
    expect(areWorkerHostsEquivalent('Bens-MBP', 'bens-mbp.local')).toBe(true);
    expect(areWorkerHostsEquivalent('f8152f2e162b', 'bens-mbp.local')).toBe(false);
  });

  it('detects mismatch when worker scope is missing or different', () => {
    expect(hasRuntimeScopeMismatch('local-436a', null)).toBe(true);
    expect(hasRuntimeScopeMismatch('wss://present.best:7880', 'ws://localhost:7880')).toBe(true);
    expect(hasRuntimeScopeMismatch('ws://localhost:7880', 'localhost:7880')).toBe(false);
    expect(hasRuntimeScopeMismatch(null, 'localhost:7880')).toBe(false);
  });

  it('detects local runtime scopes', () => {
    expect(isLocalRuntimeScope('local-436a-proof')).toBe(true);
    expect(isLocalRuntimeScope('ws://127.0.0.1:7880')).toBe(true);
    expect(isLocalRuntimeScope('wss://present.best:7880')).toBe(false);
  });
});
