import { CANVAS_STEWARD_MODEL_ENV, resolveCanvasModelName } from './canvas-models';

const DEFAULT_MODEL: ReturnType<typeof resolveCanvasModelName> = 'claude-haiku-4-5';

describe('resolveCanvasModelName', () => {
  const originalEnv = process.env[CANVAS_STEWARD_MODEL_ENV];

  const restoreEnv = () => {
    if (typeof originalEnv === 'undefined') {
      delete process.env[CANVAS_STEWARD_MODEL_ENV];
    } else {
      process.env[CANVAS_STEWARD_MODEL_ENV] = originalEnv;
    }
  };

  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('returns explicit model when overrides are allowed', () => {
    delete process.env[CANVAS_STEWARD_MODEL_ENV];
    const result = resolveCanvasModelName({ explicit: 'gpt-5', allowOverride: true });
    expect(result).toBe('gpt-5');
  });

  it('ignores explicit model when overrides are not allowed', () => {
    delete process.env[CANVAS_STEWARD_MODEL_ENV];
    const result = resolveCanvasModelName({ explicit: 'gpt-5', allowOverride: false });
    expect(result).toBe(DEFAULT_MODEL);
  });

  it('prefers env override when overrides are not allowed', () => {
    process.env[CANVAS_STEWARD_MODEL_ENV] = 'claude-sonnet-4-5';
    const result = resolveCanvasModelName({ explicit: 'gpt-5', allowOverride: false });
    expect(result).toBe('claude-sonnet-4-5');
  });

  it('allows explicit to override env when overrides are allowed', () => {
    process.env[CANVAS_STEWARD_MODEL_ENV] = 'claude-sonnet-4-5';
    const result = resolveCanvasModelName({ explicit: 'gpt-5-mini', allowOverride: true });
    expect(result).toBe('claude-sonnet-4-5');
  });
});
