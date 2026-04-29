import {
  AGENT_PROVIDER_FILTER_OPTIONS,
  AGENT_PROVIDER_LABELS,
  AGENT_PROVIDER_ORDER,
  sortAgentProviderEntries,
} from './provider-presentation';

describe('provider-presentation', () => {
  it('keeps filter options aligned with provider order and labels', () => {
    expect(AGENT_PROVIDER_FILTER_OPTIONS).toEqual(
      AGENT_PROVIDER_ORDER.map((provider) => ({
        value: provider,
        label: AGENT_PROVIDER_LABELS[provider],
      })),
    );
  });

  it('sorts provider entries by the shared provider order', () => {
    expect(
      sortAgentProviderEntries([
        ['xai', 1],
        ['openai', 2],
        ['fal', 3],
        ['unknown-provider', 4],
        ['anthropic', 5],
      ]),
    ).toEqual([
      ['openai', 2],
      ['anthropic', 5],
      ['fal', 3],
      ['xai', 1],
      ['unknown-provider', 4],
    ]);
  });

  it('covers every known provider in the shared order', () => {
    expect([...AGENT_PROVIDER_ORDER].sort()).toEqual(
      Object.keys(AGENT_PROVIDER_LABELS).sort(),
    );
  });
});
