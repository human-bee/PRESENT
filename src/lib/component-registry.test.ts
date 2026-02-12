import { ComponentRegistry } from './component-registry';

describe('ComponentRegistry version convergence', () => {
  beforeEach(() => {
    ComponentRegistry.clear();
  });

  afterEach(() => {
    ComponentRegistry.clear();
  });

  it('accepts monotonic versions and rejects stale ones', async () => {
    ComponentRegistry.register({
      messageId: 'cmp-1',
      componentType: 'TestWidget',
      props: { value: 0, version: 0, lastUpdated: 1 },
      contextKey: 'canvas',
      timestamp: Date.now(),
    });

    const v1 = await ComponentRegistry.update(
      'cmp-1',
      { value: 1, version: 1, lastUpdated: 10 },
      { version: 1, timestamp: 10, source: 'test' },
    );
    expect(v1.success).toBe(true);
    expect((ComponentRegistry.get('cmp-1')?.props as any)?.value).toBe(1);

    const stale = await ComponentRegistry.update(
      'cmp-1',
      { value: 999, version: 0, lastUpdated: 5 },
      { version: 0, timestamp: 5, source: 'test' },
    );
    expect(stale.success).toBe(true);
    expect((stale as any).ignored).toBe(true);
    expect((ComponentRegistry.get('cmp-1')?.props as any)?.value).toBe(1);

    const v2 = await ComponentRegistry.update(
      'cmp-1',
      { value: 2, version: 2, lastUpdated: 20 },
      { version: 2, timestamp: 20, source: 'test' },
    );
    expect(v2.success).toBe(true);
    expect((ComponentRegistry.get('cmp-1')?.props as any)?.value).toBe(2);
  });

  it('allows repeated updates when allowRepeat meta is provided', async () => {
    ComponentRegistry.register({
      messageId: 'cmp-2',
      componentType: 'Diagnostics',
      props: { beats: 0, version: 0, lastUpdated: 1 },
      contextKey: 'canvas',
      timestamp: Date.now(),
    });

    const first = await ComponentRegistry.update(
      'cmp-2',
      {
        beats: 1,
        version: 1,
        lastUpdated: 2,
        __meta: { allowRepeat: true },
      } as any,
      { version: 1, timestamp: 2, source: 'test' },
    );
    expect(first.success).toBe(true);

    const second = await ComponentRegistry.update(
      'cmp-2',
      {
        beats: 1,
        version: 2,
        lastUpdated: 3,
        __meta: { allowRepeat: true },
      } as any,
      { version: 2, timestamp: 3, source: 'test' },
    );
    expect(second.success).toBe(true);
    expect((second as any).isCircuitBreakerBlock).toBeUndefined();
  });
});

