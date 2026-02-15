import { getRuntimeModelKey, withRuntimeModelKeys } from '@/lib/agents/shared/model-runtime-context';

describe('model runtime context', () => {
  it('returns undefined outside runtime scope', () => {
    expect(getRuntimeModelKey('OPENAI_API_KEY')).toBeUndefined();
    expect(getRuntimeModelKey('ANTHROPIC_API_KEY')).toBeUndefined();
    expect(getRuntimeModelKey('GOOGLE_API_KEY')).toBeUndefined();
  });

  it('surfaces scoped keys and restores parent scope on exit', async () => {
    await withRuntimeModelKeys({ OPENAI_API_KEY: '  outer-key  ', GOOGLE_API_KEY: 'outer-google' }, async () => {
      expect(getRuntimeModelKey('OPENAI_API_KEY')).toBe('outer-key');
      expect(getRuntimeModelKey('GOOGLE_API_KEY')).toBe('outer-google');

      await withRuntimeModelKeys({ OPENAI_API_KEY: 'inner-key', ANTHROPIC_API_KEY: 'inner-anthropic' }, async () => {
        expect(getRuntimeModelKey('OPENAI_API_KEY')).toBe('inner-key');
        expect(getRuntimeModelKey('ANTHROPIC_API_KEY')).toBe('inner-anthropic');
        expect(getRuntimeModelKey('GOOGLE_API_KEY')).toBeUndefined();
      });

      expect(getRuntimeModelKey('OPENAI_API_KEY')).toBe('outer-key');
      expect(getRuntimeModelKey('ANTHROPIC_API_KEY')).toBeUndefined();
      expect(getRuntimeModelKey('GOOGLE_API_KEY')).toBe('outer-google');
    });

    expect(getRuntimeModelKey('OPENAI_API_KEY')).toBeUndefined();
  });

  it('treats blank values as unset', async () => {
    await withRuntimeModelKeys({ OPENAI_API_KEY: '   ' }, async () => {
      expect(getRuntimeModelKey('OPENAI_API_KEY')).toBeUndefined();
    });
  });
});
