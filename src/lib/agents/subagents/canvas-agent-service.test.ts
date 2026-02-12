import { CanvasAgentService } from './canvas-agent-service';

describe('CanvasAgentService provider validation', () => {
  it('throws a clear error when no providers are configured', () => {
    const service = new CanvasAgentService({
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      GOOGLE_API_KEY: '',
    });
    expect(() => service.getModelForStreaming('gpt-5')).toThrow(
      'No canvas model providers configured.',
    );
  });

  it('falls back to an available provider when preferred provider is missing', () => {
    const service = new CanvasAgentService({
      OPENAI_API_KEY: 'test-key',
      ANTHROPIC_API_KEY: '',
      GOOGLE_API_KEY: '',
    });
    const result = service.getModelForStreaming('claude-sonnet-4-5');
    expect(result.modelDefinition.name).toBe('gpt-5');
    expect(result.modelDefinition.provider).toBe('openai');
  });
});
