import { inferScorecardTopicFromText, resolveDebatePlayerSeedFromLabels } from '../scorecard';

describe('voice-agent scorecard helpers', () => {
  it('infers scorecard topic from explicit markers', () => {
    expect(inferScorecardTopicFromText('create a debate scorecard about: Nuclear energy policy')).toBe(
      'Nuclear energy policy',
    );
    expect(inferScorecardTopicFromText('topic is "Universal basic income" for this debate')).toBe(
      '"Universal basic income" for this debate',
    );
  });

  it('returns undefined when debate context is missing', () => {
    expect(inferScorecardTopicFromText('add a timer')).toBeUndefined();
  });

  it('derives AFF/NEG seeds from participant labels', () => {
    const players = resolveDebatePlayerSeedFromLabels(['Alice', 'Bob', 'alice']);
    expect(players[0]).toEqual({ side: 'AFF', label: 'Alice' });
    expect(players[1]).toEqual({ side: 'NEG', label: 'Bob' });
  });
});
