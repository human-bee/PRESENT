import assert from 'node:assert/strict';
import test from 'node:test';
import { rollValues, shuffleOrder, standardDeck } from '../src/widgets/packs/game-state.ts';

test('shuffleOrder rejects IDs outside the record identity contract', () => {
  const invalidIds = [
    '', ' ', 'two words', 'tab\tid', 'line\nbreak', 'id\n', 'id\r', 'id\r\n',
    'id\u2028', 'id\u2029', 'card:id', 'a'.repeat(101), 'a'.repeat(100) + '\n',
    'id.with.dot', 'id/slash', 'café',
  ];
  for (const id of invalidIds) {
    assert.throws(() => shuffleOrder([id], []), /Invalid shuffle\./, JSON.stringify(id));
    assert.throws(() => shuffleOrder(['valid', id], [0]), /Invalid shuffle\./, JSON.stringify(id));
  }
});

test('shuffleOrder accepts letters, digits, underscores, hyphens and boundary lengths', () => {
  for (const id of ['a', '0', '_', '-', 'Az09_-', 'a'.repeat(100)]) {
    assert.deepEqual(shuffleOrder([id], []), { [`order:${id}`]: 0 });
  }
});

test('shuffleOrder rejects duplicate IDs', () => {
  assert.throws(() => shuffleOrder(['same', 'same'], [0]), /Invalid shuffle\./);
  assert.throws(() => shuffleOrder(['a', 'b', 'a'], [0, 0]), /Invalid shuffle\./);
});

test('shuffleOrder preserves empty and singleton decks', () => {
  const empty = Object.freeze([]);
  const singleton = Object.freeze(['card-1']);
  const noSamples = Object.freeze([]);
  const extraSamples = Object.freeze([0, 0.5]);
  assert.deepEqual(shuffleOrder(empty, noSamples), {});
  assert.deepEqual(shuffleOrder(empty, extraSamples), {});
  assert.deepEqual(shuffleOrder(singleton, noSamples), { 'order:card-1': 0 });
  assert.deepEqual(shuffleOrder(singleton, extraSamples), { 'order:card-1': 0 });
  assert.deepEqual(empty, []);
  assert.deepEqual(singleton, ['card-1']);
  assert.deepEqual(noSamples, []);
  assert.deepEqual(extraSamples, [0, 0.5]);
});

test('shuffleOrder preserves deterministic shuffling and does not mutate inputs', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const samples = [0.5, 0, 0.99];
  const expected = { 'order:d': 0, 'order:b': 1, 'order:a': 2, 'order:c': 3 };
  assert.deepEqual(shuffleOrder(ids, samples), expected);
  assert.deepEqual(shuffleOrder(ids, samples), expected);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  assert.deepEqual(samples, [0.5, 0, 0.99]);
  assert.deepEqual(shuffleOrder(['a', 'b'], [0]), { 'order:b': 0, 'order:a': 1 });
  assert.deepEqual(shuffleOrder(['a', 'b'], [0.999]), { 'order:a': 0, 'order:b': 1 });
});

test('shuffleOrder uses Fisher-Yates lower and upper sample boundaries at every step', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const belowOne = 1 - Number.EPSILON / 2;
  assert.deepEqual(shuffleOrder(ids, [0, 0, 0]), {
    'order:b': 0, 'order:c': 1, 'order:d': 2, 'order:a': 3,
  });
  assert.deepEqual(shuffleOrder(ids, [belowOne, belowOne, belowOne]), {
    'order:a': 0, 'order:b': 1, 'order:c': 2, 'order:d': 3,
  });
});

test('shuffleOrder selects the correct index immediately below and at each bucket boundary', () => {
  const high = 1 - Number.EPSILON / 2;
  const epsilon = Number.EPSILON;
  const cases = [
    // Later self-swaps isolate the first selection, from four cards.
    [[0.25 - epsilon, high, high], ['d', 'b', 'c', 'a']],
    [[0.25, high, high], ['a', 'd', 'c', 'b']],
    [[0.5 - epsilon, high, high], ['a', 'd', 'c', 'b']],
    [[0.5, high, high], ['a', 'b', 'd', 'c']],
    [[0.75 - epsilon, high, high], ['a', 'b', 'd', 'c']],
    [[0.75, high, high], ['a', 'b', 'c', 'd']],
    // Self-swaps around the second selection isolate its three-card range.
    [[high, 1 / 3 - epsilon, high], ['c', 'b', 'a', 'd']],
    [[high, 1 / 3, high], ['a', 'c', 'b', 'd']],
    [[high, 2 / 3 - epsilon, high], ['a', 'c', 'b', 'd']],
    [[high, 2 / 3, high], ['a', 'b', 'c', 'd']],
    // The final selection has two cards remaining.
    [[high, high, 0.5 - epsilon], ['b', 'a', 'c', 'd']],
    [[high, high, 0.5], ['a', 'b', 'c', 'd']],
  ];
  for (const [samples, order] of cases) {
    const expected = Object.fromEntries(order.map((id, index) => [`order:${id}`, index]));
    assert.deepEqual(shuffleOrder(['a', 'b', 'c', 'd'], samples), expected, JSON.stringify(samples));
  }
});

test('shuffleOrder preserves frozen input arrays, including unused samples', () => {
  const ids = Object.freeze(['a', 'b', 'c', 'd']);
  const samples = Object.freeze([0.5, 0, 0.99, 0.25]);
  const expected = { 'order:d': 0, 'order:b': 1, 'order:a': 2, 'order:c': 3 };
  assert.deepEqual(shuffleOrder(ids, samples), expected);
  assert.deepEqual(shuffleOrder(ids, samples), expected);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  assert.deepEqual(samples, [0.5, 0, 0.99, 0.25]);
});

test('shuffleOrder preserves sample-count validation and accepts extra valid samples', () => {
  assert.throws(() => shuffleOrder(['a', 'b'], []), /Invalid shuffle\./);
  assert.throws(() => shuffleOrder(['a', 'b', 'c'], [0]), /Invalid shuffle\./);
  assert.deepEqual(shuffleOrder(['a', 'b'], [0, 0.5]), { 'order:b': 0, 'order:a': 1 });
});

test('shuffleOrder rejects invalid samples, including unused samples', () => {
  for (const sample of [-0.01, 1, NaN, Infinity, -Infinity]) {
    assert.throws(() => shuffleOrder([], [sample]), /Invalid shuffle\./);
    assert.throws(() => shuffleOrder(['a'], [sample]), /Invalid shuffle\./);
    assert.throws(() => shuffleOrder(['a', 'b'], [sample]), /Invalid shuffle\./);
    assert.throws(() => shuffleOrder(['a', 'b'], [0, sample]), /Invalid shuffle\./);
  }
});

test('standardDeck preserves all 52 cards and their initial order and state', () => {
  const expected = {};
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 0; rank < 13; rank++) {
      const id = `${suit}-${rank}`;
      expected[`card:${id}`] = {
        id, label: ranks[rank] + suits[suit], suit: suits[suit], location: 'deck', faceUp: false,
      };
      expected[`order:${id}`] = suit * 13 + rank;
    }
  }
  assert.deepEqual(standardDeck(), expected);
  const changed = standardDeck();
  changed['card:0-0'].faceUp = true;
  assert.deepEqual(standardDeck(), expected);
});

test('shuffleOrder accepts the complete standard deck', () => {
  const deck = standardDeck();
  const ids = Object.values(deck).filter((value) => typeof value === 'object').map((card) => card.id);
  const samples = Array(51).fill(0.999);
  const expected = Object.fromEntries(Object.entries(deck).filter(([key]) => key.startsWith('order:')));
  assert.deepEqual(shuffleOrder(ids, samples), expected);
});

test('shuffleOrder produces unique contiguous orders for a shuffled 52-card deck', () => {
  const deck = standardDeck();
  const originalDeck = structuredClone(deck);
  const ids = Object.values(deck).filter((value) => typeof value === 'object').map((card) => card.id);
  const fixedSamples = [0, 1 - Number.EPSILON / 2, 0.25, 0.5, 0.75];
  const samples = Array.from({ length: 51 }, (_, index) => fixedSamples[index % fixedSamples.length]);
  const originalIds = [...ids];
  const originalSamples = [...samples];
  const result = shuffleOrder(ids, samples);
  const values = Object.values(result);
  const initialOrder = Object.fromEntries(Object.entries(deck).filter(([key]) => key.startsWith('order:')));
  assert.equal(ids.length, 52);
  assert.equal(new Set(ids).size, 52);
  assert.ok(ids.every((id) => /^[\w-]{1,100}$/.test(id)));
  assert.equal(Object.keys(result).length, 52);
  assert.deepEqual(Object.keys(result).sort(), ids.map((id) => `order:${id}`).sort());
  assert.equal(new Set(values).size, 52);
  assert.deepEqual([...values].sort((a, b) => a - b), Array.from({ length: 52 }, (_, index) => index));
  assert.notDeepEqual(result, initialOrder);
  assert.deepEqual(shuffleOrder(ids, samples), result);
  assert.deepEqual(ids, originalIds);
  assert.deepEqual(samples, originalSamples);
  assert.deepEqual(deck, originalDeck);
});

test('rollValues preserves supported dice and boundary mapping', () => {
  const samples = [0, 0.5, 0.999999];
  for (const [sides, expected] of [
    [4, [1, 3, 4]], [6, [1, 4, 6]], [8, [1, 5, 8]], [10, [1, 6, 10]],
    [12, [1, 7, 12]], [20, [1, 11, 20]], [100, [1, 51, 100]],
  ]) {
    assert.deepEqual(rollValues(sides, samples), expected);
  }
  assert.deepEqual(samples, [0, 0.5, 0.999999]);
  assert.deepEqual(rollValues(6, [0]), [1]);
  assert.deepEqual(rollValues(6, Array(6).fill(0.5)), Array(6).fill(4));
});

test('rollValues preserves rejection of unsupported dice and invalid sample counts', () => {
  for (const sides of [0, 1, 3, 5, 7, 99, 101, 6.5, NaN, Infinity]) {
    assert.throws(() => rollValues(sides, [0]), /Invalid dice roll\./);
  }
  assert.throws(() => rollValues(6, []), /Invalid dice roll\./);
  assert.throws(() => rollValues(6, Array(7).fill(0)), /Invalid dice roll\./);
});

test('rollValues preserves rejection of invalid samples', () => {
  for (const sample of [-0.01, 1, NaN, Infinity, -Infinity]) {
    assert.throws(() => rollValues(6, [sample]), /Invalid dice roll\./);
    assert.throws(() => rollValues(6, [0, sample]), /Invalid dice roll\./);
  }
});
