describe('catalog schema guards', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('falls back when action schemas throw on safeParse access', async () => {
    jest.doMock('@/lib/canvas-agent/contract/types', () => ({
      LEGACY_ACTION_NAMES: ['create_shape'],
    }));
    jest.doMock('@/lib/canvas-agent/contract/teacher', () => ({
      TEACHER_ACTIONS: [],
    }));
    jest.doMock('@/lib/canvas-agent/contract/parsers', () => {
      const malformedSchema: Record<string, unknown> = {};
      Object.defineProperty(malformedSchema, 'safeParse', {
        get() {
          throw new Error("Cannot read properties of undefined (reading '_zod')");
        },
      });
      return {
        actionParamSchemas: {
          create_shape: malformedSchema,
        },
      };
    });

    const catalog = await import('./catalog');
    expect(() => catalog.getActionSchemaJson()).not.toThrow();
    const schema = catalog.getActionSchemaJson() as Record<string, unknown>;
    expect(typeof schema).toBe('object');
    expect(Object.keys(schema)).not.toHaveLength(0);
  });
});
