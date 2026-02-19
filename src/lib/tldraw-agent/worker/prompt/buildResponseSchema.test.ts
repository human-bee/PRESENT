import { z } from 'zod';

const getAgentActionUtilsRecordMock = jest.fn();

jest.mock('../../shared/AgentUtils', () => ({
  getAgentActionUtilsRecord: (...args: unknown[]) => getAgentActionUtilsRecordMock(...args),
}));

describe('buildResponseSchema (tldraw-agent)', () => {
  beforeEach(() => {
    getAgentActionUtilsRecordMock.mockReset();
  });

  it('returns fallback schema when action schemas are missing', async () => {
    getAgentActionUtilsRecordMock.mockReturnValue({
      fake: { getSchema: () => ({}) },
    });

    const { buildResponseSchema } = await import('./buildResponseSchema');
    const schema = buildResponseSchema() as Record<string, unknown>;
    expect(JSON.stringify(schema)).toContain('"actions"');
  });

  it('builds schema from valid zod action schema', async () => {
    getAgentActionUtilsRecordMock.mockReturnValue({
      create: {
        getSchema: () =>
          z.object({
            _type: z.literal('create'),
            shape: z.string(),
          }),
      },
    });

    const { buildResponseSchema } = await import('./buildResponseSchema');
    const schema = buildResponseSchema() as Record<string, unknown>;
    expect(typeof schema).toBe('object');
    const serialized = JSON.stringify(schema);
    expect(serialized).toContain('"actions"');
    expect(serialized).toContain('"create"');
    expect(serialized).toContain('"shape"');
  });

  it('skips malformed schema internals without touching _zod', async () => {
    const schemaLike: Record<string, unknown> = {
      _def: { typeName: 'ZodObject' },
      parse: jest.fn(),
      safeParse: jest.fn(),
    };
    Object.defineProperty(schemaLike, '_zod', {
      get() {
        throw new Error('should not read _zod');
      },
    });
    getAgentActionUtilsRecordMock.mockReturnValue({
      malformed: {
        getSchema: () => schemaLike,
      },
    });

    const { buildResponseSchema } = await import('./buildResponseSchema');
    expect(() => buildResponseSchema()).not.toThrow();
  });
});
