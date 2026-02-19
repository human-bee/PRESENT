import { createManualInputRouter } from '../manual-routing';

const mockGenerateObject = jest.fn();
const mockModelFactory = jest.fn(() => ({ provider: 'anthropic.messages', modelId: 'claude-haiku-4-5-20251001' }));
const mockCreateAnthropic = jest.fn(() => mockModelFactory);

jest.mock('ai', () => ({
  generateObject: (...args: any[]) => mockGenerateObject(...args),
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: any[]) => mockCreateAnthropic(...args),
}));

describe('manual routing', () => {
  const restoreEnv = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    attempts: process.env.VOICE_AGENT_ROUTER_RETRY_ATTEMPTS,
    baseDelay: process.env.VOICE_AGENT_ROUTER_RETRY_BASE_DELAY_MS,
    maxDelay: process.env.VOICE_AGENT_ROUTER_RETRY_MAX_DELAY_MS,
  };

  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockModelFactory.mockClear();
    mockCreateAnthropic.mockClear();
    process.env.ANTHROPIC_API_KEY = restoreEnv.apiKey;
    process.env.VOICE_AGENT_ROUTER_RETRY_ATTEMPTS = restoreEnv.attempts;
    process.env.VOICE_AGENT_ROUTER_RETRY_BASE_DELAY_MS = restoreEnv.baseDelay;
    process.env.VOICE_AGENT_ROUTER_RETRY_MAX_DELAY_MS = restoreEnv.maxDelay;
  });

  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = restoreEnv.apiKey;
    process.env.VOICE_AGENT_ROUTER_RETRY_ATTEMPTS = restoreEnv.attempts;
    process.env.VOICE_AGENT_ROUTER_RETRY_BASE_DELAY_MS = restoreEnv.baseDelay;
    process.env.VOICE_AGENT_ROUTER_RETRY_MAX_DELAY_MS = restoreEnv.maxDelay;
  });

  it('falls back to local heuristic routing when anthropic api key is not configured', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const routeManualInput = createManualInputRouter();
    await expect(routeManualInput('draw a cat')).resolves.toEqual({
      route: 'canvas',
      message: 'draw a cat',
    });
    await expect(routeManualInput('open crowd pulse')).resolves.toEqual({ route: 'none' });
    if (previous) {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it('retries transient anthropic overload errors before succeeding', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.VOICE_AGENT_ROUTER_RETRY_ATTEMPTS = '3';
    process.env.VOICE_AGENT_ROUTER_RETRY_BASE_DELAY_MS = '0';
    process.env.VOICE_AGENT_ROUTER_RETRY_MAX_DELAY_MS = '1';

    mockGenerateObject
      .mockRejectedValueOnce(Object.assign(new Error('Overloaded'), { statusCode: 529 }))
      .mockResolvedValue({ object: { route: 'canvas', message: 'draw a bunny' } });

    const routeManualInput = createManualInputRouter();
    await expect(routeManualInput('draw a bunny')).resolves.toEqual({
      route: 'canvas',
      message: 'draw a bunny',
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('falls back to heuristic routing when transient retries are exhausted', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.VOICE_AGENT_ROUTER_RETRY_ATTEMPTS = '2';
    process.env.VOICE_AGENT_ROUTER_RETRY_BASE_DELAY_MS = '0';
    process.env.VOICE_AGENT_ROUTER_RETRY_MAX_DELAY_MS = '1';

    mockGenerateObject.mockRejectedValue(Object.assign(new Error('Overloaded'), { statusCode: 529 }));

    const routeManualInput = createManualInputRouter();
    await expect(routeManualInput('draw a cat')).resolves.toEqual({
      route: 'canvas',
      message: 'draw a cat',
    });
    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
  });
});
