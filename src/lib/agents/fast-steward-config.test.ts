jest.mock('@cerebras/cerebras_cloud_sdk', () => jest.fn());

import { normalizeFastStewardModel } from './fast-steward-config';

describe('normalizeFastStewardModel', () => {
  it('falls back to the default model when input is empty', () => {
    expect(normalizeFastStewardModel(undefined)).toBe('llama3.3-70b');
    expect(normalizeFastStewardModel('   ')).toBe('llama3.3-70b');
  });

  it('normalizes common llama alias forms used in env vars', () => {
    expect(normalizeFastStewardModel('llama-3.3-70b')).toBe('llama3.3-70b');
    expect(normalizeFastStewardModel('cerebras:llama-3.3-70b')).toBe('llama3.3-70b');
    expect(normalizeFastStewardModel('cerebras/llama3-3-70b')).toBe('llama3.3-70b');
  });

  it('preserves supported explicit model names', () => {
    expect(normalizeFastStewardModel('gpt-oss-120b')).toBe('gpt-oss-120b');
    expect(normalizeFastStewardModel('qwen3-32b')).toBe('qwen3-32b');
  });
});
