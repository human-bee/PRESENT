import { CAPABILITY_PROFILES, WIDGET_TIERS } from './capability-contract';

describe('capability-contract', () => {
  it('exports the canonical capability profiles', () => {
    expect(CAPABILITY_PROFILES).toEqual(['full', 'lean_adaptive']);
  });

  it('exports the canonical widget tiers', () => {
    expect(WIDGET_TIERS).toEqual(['tier1', 'tier2']);
  });
});
