/**
 * @jest-environment node
 */

import '@cerebras/cerebras_cloud_sdk/shims/node';

describe('selectModel', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalCerebrasKey = process.env.CEREBRAS_API_KEY;

  const restoreEnv = () => {
    if (typeof originalOpenAiKey === 'undefined') {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }

    if (typeof originalCerebrasKey === 'undefined') {
      delete process.env.CEREBRAS_API_KEY;
    } else {
      process.env.CEREBRAS_API_KEY = originalCerebrasKey;
    }
  };

  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('routes bare gpt-oss-120b requests to the Cerebras provider', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.CEREBRAS_API_KEY = 'test-cerebras-key';

    let selectModel: ((preferred?: string) => { name: string }) | null = null;

    await jest.isolateModulesAsync(async () => {
      ({ selectModel } = await import('./models'));
    });

    expect(selectModel).not.toBeNull();
    expect(selectModel?.('gpt-oss-120b').name).toBe('cerebras:gpt-oss-120b');
  });
});
