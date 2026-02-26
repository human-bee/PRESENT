describe('model-control apply config', () => {
  const ENV_KEY = 'MODEL_CONTROL_APPLY_CONFIG_JSON';
  const originalEnv = process.env[ENV_KEY];

  const restoreEnv = () => {
    if (typeof originalEnv === 'undefined') {
      delete process.env[ENV_KEY];
      return;
    }
    process.env[ENV_KEY] = originalEnv;
  };

  afterEach(() => {
    restoreEnv();
    jest.resetModules();
  });

  afterAll(() => {
    restoreEnv();
  });

  it('returns empty config when env is not set', () => {
    delete process.env[ENV_KEY];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelControlApplyConfig } = require('./apply-config');
    expect(getModelControlApplyConfig()).toEqual({});
  });

  it('parses valid json payload', () => {
    process.env[ENV_KEY] = JSON.stringify({
      vercel: {
        token: 'v-token',
        projectName: 'present',
      },
      railway: {
        token: 'r-token',
        projectId: 'project-1',
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelControlApplyConfig } = require('./apply-config');
    expect(getModelControlApplyConfig()).toEqual({
      vercel: {
        token: 'v-token',
        projectName: 'present',
      },
      railway: {
        token: 'r-token',
        projectId: 'project-1',
      },
    });
  });

  it('normalizes trailing literal newline characters from env payload', () => {
    process.env[ENV_KEY] = `${JSON.stringify({ vercel: { token: 'abc' } })}\\n\\r`;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelControlApplyConfig } = require('./apply-config');
    expect(getModelControlApplyConfig()).toEqual({
      vercel: {
        token: 'abc',
      },
    });
  });

  it('throws on invalid json payload', () => {
    process.env[ENV_KEY] = '{"vercel":';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelControlApplyConfig } = require('./apply-config');
    expect(() => getModelControlApplyConfig()).toThrow(
      'Invalid MODEL_CONTROL_APPLY_CONFIG_JSON: expected valid JSON',
    );
  });

  it('throws on schema-invalid payload', () => {
    process.env[ENV_KEY] = JSON.stringify({
      vercel: {
        token: 'v-token',
      },
      unexpected: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelControlApplyConfig } = require('./apply-config');
    expect(() => getModelControlApplyConfig()).toThrow(
      'Invalid MODEL_CONTROL_APPLY_CONFIG_JSON: schema validation failed',
    );
  });

  it('throws when nested provider object has unknown keys', () => {
    process.env[ENV_KEY] = JSON.stringify({
      vercel: {
        token: 'v-token',
        projectID: 'typo-key',
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getModelControlApplyConfig } = require('./apply-config');
    expect(() => getModelControlApplyConfig()).toThrow(
      'Invalid MODEL_CONTROL_APPLY_CONFIG_JSON: schema validation failed',
    );
  });
});

describe('pickFirstNonEmpty', () => {
  it('returns the first non-empty trimmed value', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pickFirstNonEmpty } = require('./apply-config');
    expect(pickFirstNonEmpty(undefined, '   ', '\n', ' value ', 'backup')).toBe('value');
  });

  it('returns null when all values are empty', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pickFirstNonEmpty } = require('./apply-config');
    expect(pickFirstNonEmpty(undefined, null, ' ', '')).toBeNull();
  });
});
