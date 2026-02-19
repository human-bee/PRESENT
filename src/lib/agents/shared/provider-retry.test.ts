import { isRetryableProviderError, withProviderRetry } from './provider-retry';

describe('provider retry', () => {
  it('retries retryable provider errors and eventually succeeds', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(Object.assign(new Error('Overloaded'), { statusCode: 529 }))
      .mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await withProviderRetry(operation, {
      provider: 'anthropic',
      attempts: 3,
      initialDelayMs: 5,
      maxDelayMs: 5,
      jitterRatio: 0,
      sleep,
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it('does not retry non-retryable errors', async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new Error('schema_missing:canvas_plan'));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      withProviderRetry(operation, {
        provider: 'anthropic',
        attempts: 4,
        initialDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
        sleep,
      }),
    ).rejects.toThrow('schema_missing:canvas_plan');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('classifies overload/rate-limit style failures as retryable', () => {
    expect(isRetryableProviderError(Object.assign(new Error('Overloaded'), { statusCode: 529 }))).toBe(true);
    expect(
      isRetryableProviderError(
        Object.assign(new Error('Request failed'), {
          responseBody: '{"detail":"rate limit exceeded"}',
        }),
      ),
    ).toBe(true);
    expect(isRetryableProviderError(new Error('schema_missing:canvas_plan'))).toBe(false);
  });
});
