import { getBooleanFlag, getNumberFlag, isFairyClientAgentEnabled, parseCsvFlag } from './feature-flags';

describe('feature flags', () => {
  it('parses quoted booleans', () => {
    expect(getBooleanFlag('"true"', false)).toBe(true);
    expect(getBooleanFlag('"false"', true)).toBe(false);
    expect(getBooleanFlag('"true\\n"', false)).toBe(true);
    expect(getBooleanFlag('FALSE', true)).toBe(false);
  });

  it('defaults fairy client agent flag to false when unset', () => {
    expect(isFairyClientAgentEnabled(undefined)).toBe(false);
  });

  it('respects explicit fairy client agent flag values', () => {
    expect(isFairyClientAgentEnabled('true')).toBe(true);
    expect(isFairyClientAgentEnabled('false')).toBe(false);
  });

  it('parses numbers with fallback', () => {
    expect(getNumberFlag('42', 7)).toBe(42);
    expect(getNumberFlag('bad', 7)).toBe(7);
  });

  it('parses csv lists', () => {
    expect(parseCsvFlag('a, b , ,c')).toEqual(['a', 'b', 'c']);
    expect(parseCsvFlag(undefined)).toEqual([]);
  });
});
