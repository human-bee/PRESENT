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
    const result = resolveCanvasModelName({ explicit: 'gpt-4o', allowOverride: true });
    expect(result).toBe('gpt-4o');
  });

  it('ignores explicit model when overrides are not allowed', () => {
    delete process.env[CANVAS_STEWARD_MODEL_ENV];
    const result = resolveCanvasModelName({ explicit: 'gpt-4o', allowOverride: false });
    expect(result).toBe(DEFAULT_MODEL);
  });

  it('prefers env override when overrides are not allowed', () => {
    process.env[CANVAS_STEWARD_MODEL_ENV] = 'claude-4.5-sonnet';
    const result = resolveCanvasModelName({ explicit: 'gpt-4o', allowOverride: false });
    expect(result).toBe('claude-4.5-sonnet');
  });

  it('allows explicit to override env when overrides are allowed', () => {
    process.env[CANVAS_STEWARD_MODEL_ENV] = 'claude-3.5-sonnet';
    const result = resolveCanvasModelName({ explicit: 'gpt-4o', allowOverride: true });
    expect(result).toBe('gpt-4o');
  });
});
