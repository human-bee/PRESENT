import { getBooleanFlag, isFairyClientAgentEnabled } from './feature-flags';

describe('feature flags', () => {
  it('parses quoted booleans', () => {
    expect(getBooleanFlag('"true"', false)).toBe(true);
    expect(getBooleanFlag('"false"', true)).toBe(false);
  });

  it('defaults fairy client agent flag to false when unset', () => {
    expect(isFairyClientAgentEnabled(undefined)).toBe(false);
  });

  it('respects explicit fairy client agent flag values', () => {
    expect(isFairyClientAgentEnabled('true')).toBe(true);
    expect(isFairyClientAgentEnabled('false')).toBe(false);
  });
});
