import {
  buildProviderLinkUrl,
  deriveProviderParity,
  inferProviderFromModel,
  normalizeProvider,
  normalizeProviderPath,
  normalizeProviderSource,
} from './provider-parity';

describe('provider-parity', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes provider/source/path values', () => {
    expect(normalizeProvider('OpenAI')).toBe('openai');
    expect(normalizeProvider('unknown-provider')).toBe('unknown');
    expect(normalizeProviderSource('runtime_selected')).toBe('runtime_selected');
    expect(normalizeProviderSource('bogus')).toBe('unknown');
    expect(normalizeProviderPath('fast')).toBe('fast');
    expect(normalizeProviderPath('bogus')).toBe('unknown');
  });

  it('infers provider from model names', () => {
    expect(inferProviderFromModel('gpt-5-mini')).toBe('openai');
    expect(inferProviderFromModel('claude-3-5-sonnet')).toBe('anthropic');
    expect(inferProviderFromModel('gemini-2.5-pro')).toBe('google');
    expect(inferProviderFromModel('llama-3.3-70b')).toBe('cerebras');
    expect(inferProviderFromModel('black-forest-labs/flux-1')).toBe('together');
  });

  it('derives provider parity from explicit, params, and payload fields', () => {
    const parity = deriveProviderParity({
      task: 'fairy.intent',
      stage: 'failed',
      status: 'failed',
      params: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        provider_path: 'fallback',
      },
      payload: {
        error: { message: 'timeout' },
      },
    });

    expect(parity).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      providerSource: 'task_params',
      providerPath: 'fallback',
    });
  });

  it('renders provider links only when template resolves to a valid URL', () => {
    process.env.AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_OPENAI =
      'https://platform.openai.com/logs?trace={traceId}&req={providerRequestId}&model={model}';

    const url = buildProviderLinkUrl('openai', {
      traceId: 'trace-1',
      providerRequestId: 'req-1',
      model: 'gpt-5-mini',
    });

    expect(url).toContain('trace=trace-1');
    expect(url).toContain('req=req-1');
    expect(url).toContain('model=gpt-5-mini');
    expect(buildProviderLinkUrl('debug', { traceId: 'trace-1' })).toBeNull();

    process.env.AGENT_ADMIN_PROVIDER_LINK_TEMPLATE_OPENAI = 'notaurl';
    expect(buildProviderLinkUrl('openai', { traceId: 'trace-2' })).toBeNull();
  });
});
