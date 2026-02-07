import { LinearMcpClient } from './linear-mcp-client';

describe('LinearMcpClient rate limiting', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces max requests per minute using the sliding window', async () => {
    const client = new LinearMcpClient('dummy');

    // Force a low limit for the test and bypass network concerns
    (client as any).maxRequestsPerMinute = 2;

    await (client as any).enforceRateLimit();
    await (client as any).enforceRateLimit();

    let finished = false;
    const third = (client as any).enforceRateLimit().then(() => {
      finished = true;
    });

    // Should be waiting because the window is full
    await Promise.resolve();
    expect(finished).toBe(false);

    // Advance nearly a minute – still blocked
    jest.advanceTimersByTime(59_000);
    await Promise.resolve();
    expect(finished).toBe(false);

    // Advance past the 60s window; the oldest timestamp drops and the promise resolves
    jest.advanceTimersByTime(2_000);
    await third;
    expect(finished).toBe(true);
  });
});
