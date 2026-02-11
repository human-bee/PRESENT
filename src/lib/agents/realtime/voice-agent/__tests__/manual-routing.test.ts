import { createManualInputRouter } from '../manual-routing';

describe('manual routing', () => {
  it('returns null when anthropic api key is not configured', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const routeManualInput = createManualInputRouter();
    await expect(routeManualInput('draw a cat')).resolves.toBeNull();
    if (previous) {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
