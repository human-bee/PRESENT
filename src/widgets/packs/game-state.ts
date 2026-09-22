export type SharedCard = { id: string; label: string; suit: string; location: 'deck' | 'table'; faceUp: boolean };

export function standardDeck(): Record<string, SharedCard | number> {
  const state: Record<string, SharedCard | number> = {};
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  for (const [suitIndex, suit] of suits.entries()) {
    for (const [rankIndex, rank] of ranks.entries()) {
      const id = `${suitIndex}-${rankIndex}`;
      state[`card:${id}`] = { id, label: `${rank}${suit}`, suit, location: 'deck', faceUp: false };
      state[`order:${id}`] = suitIndex * 13 + rankIndex;
    }
  }
  return state;
}

export function rollValues(sides: number, samples: number[]): number[] {
  if (![4, 6, 8, 10, 12, 20, 100].includes(sides) || samples.length < 1 || samples.length > 6 || samples.some((sample) => !Number.isFinite(sample) || sample < 0 || sample >= 1)) throw new Error('Invalid dice roll.');
  return samples.map((sample) => Math.floor(sample * sides) + 1);
}

/** The provided sample stream makes shuffle behavior reproducible in tests. */
export function shuffleOrder(ids: string[], samples: number[]): Record<string, number> {
  if (new Set(ids).size !== ids.length || samples.length < Math.max(0, ids.length - 1) || samples.some((sample) => !Number.isFinite(sample) || sample < 0 || sample >= 1)) throw new Error('Invalid shuffle.');
  const next = [...ids];
  for (let index = next.length - 1; index > 0; index--) {
    const other = Math.floor(samples[next.length - 1 - index] * (index + 1));
    [next[index], next[other]] = [next[other], next[index]];
  }
  return Object.fromEntries(next.map((id, index) => [`order:${id}`, index]));
}
