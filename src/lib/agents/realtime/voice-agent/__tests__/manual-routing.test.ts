import { createManualInputRouter } from '../manual-routing';

describe('manual routing', () => {
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
});
