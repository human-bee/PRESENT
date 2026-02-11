import {
  getFairyConfigurationError,
  getRequiredProviderEnvKey,
  type FairyWorkerEnv,
} from './environment';

describe('fairy worker environment validation', () => {
  it('maps model provider to required key', () => {
    expect(getRequiredProviderEnvKey('gpt-5.1')).toBe('OPENAI_API_KEY');
    expect(getRequiredProviderEnvKey('claude-sonnet-4-5')).toBe('ANTHROPIC_API_KEY');
    expect(getRequiredProviderEnvKey('gemini-3-pro-preview')).toBe('GOOGLE_API_KEY');
  });

  it('reports missing key for configured FAIRY_MODEL', () => {
    const env: FairyWorkerEnv = {
      FAIRY_MODEL: 'gpt-5.1',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: 'set',
      GOOGLE_API_KEY: 'set',
    };
    expect(getFairyConfigurationError(env)).toContain('OPENAI_API_KEY');
  });

  it('passes when the configured model key is available', () => {
    const env: FairyWorkerEnv = {
      FAIRY_MODEL: 'claude-sonnet-4-5',
      OPENAI_API_KEY: 'set',
      ANTHROPIC_API_KEY: 'set',
      GOOGLE_API_KEY: '',
    };
    expect(getFairyConfigurationError(env)).toBeNull();
  });
});
