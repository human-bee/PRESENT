import { AGENT_ACTION_SCHEMAS } from './FairySchema';
import { buildResponseSchema } from './buildResponseSchema';

describe('buildResponseSchema (fairy-shared)', () => {
  it('returns fallback schema when no action types are provided', () => {
    const schema = buildResponseSchema([]) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(schema.type).toBe('object');
    expect(properties.actions).toBeDefined();
  });

  it('builds schema when at least one action type is requested', () => {
    const first = AGENT_ACTION_SCHEMAS[0] as unknown as {
      shape?: { _type?: { value?: unknown; _def?: { value?: unknown } } };
    };
    const actionType =
      typeof first.shape?._type?.value === 'string'
        ? first.shape._type.value
        : typeof first.shape?._type?._def?.value === 'string'
          ? first.shape._type._def.value
          : 'message';
    const schema = buildResponseSchema([actionType]) as Record<string, unknown>;
    const serialized = JSON.stringify(schema);

    expect(schema.type).toBe('object');
    expect(serialized).toContain('"actions"');
    expect(serialized).toContain(actionType);
  });

  it('ignores malformed literal internals without reading _zod', () => {
    const literalWithThrowingInternals: Record<string, unknown> = {};
    Object.defineProperty(literalWithThrowingInternals, '_zod', {
      get() {
        throw new Error('should not read _zod');
      },
    });
    const malformedSchema = {
      _def: { typeName: 'ZodObject' },
      parse: jest.fn(),
      safeParse: jest.fn(),
      shape: { _type: literalWithThrowingInternals },
    };
    const mutableSchemas = AGENT_ACTION_SCHEMAS as unknown as unknown[];
    mutableSchemas.unshift(malformedSchema);
    try {
      expect(() => buildResponseSchema(['message'])).not.toThrow();
    } finally {
      mutableSchemas.shift();
    }
  });

  it('ignores schema instances whose parse getter throws _zod errors', () => {
    const malformedSchema: Record<string, unknown> = {
      _def: { typeName: 'ZodObject' },
      shape: { _type: { value: 'message' } },
    };
    Object.defineProperty(malformedSchema, 'parse', {
      get() {
        throw new Error("Cannot read properties of undefined (reading '_zod')");
      },
    });
    Object.defineProperty(malformedSchema, 'safeParse', {
      get() {
        throw new Error("Cannot read properties of undefined (reading '_zod')");
      },
    });
    const mutableSchemas = AGENT_ACTION_SCHEMAS as unknown as unknown[];
    mutableSchemas.unshift(malformedSchema);
    try {
      expect(() => buildResponseSchema(['message'])).not.toThrow();
    } finally {
      mutableSchemas.shift();
    }
  });
});
