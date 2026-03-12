import {
  buildAllowedCardPool,
  parseCardRuntimeState,
  parseDiceRuntimeState,
  reduceCardRuntimeState,
  reduceDiceRuntimeState,
} from './game-widget-utils';

describe('game widget utils', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clamps dice config and values into valid ranges', () => {
    const state = parseDiceRuntimeState({
      diceCount: 8,
      diceSides: [1, 500, 12, 0, 7, 200, 4],
      dieOneSides: 1,
      dieTwoSides: 500,
      values: [0, 999, 3, 4, 8, 1, 2],
    });

    expect(state.diceCount).toBe(6);
    expect(state.diceSides).toEqual([2, 100, 12, 2, 7, 100]);
    expect(state.values).toEqual([1, 100, 3, 2, 7, 1]);
  });

  it('emits a fresh dice roll id on repeated rolls', () => {
    jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.22)
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.44);

    const first = reduceDiceRuntimeState(
      parseDiceRuntimeState({ diceCount: 1, dieOneSides: 6 }),
      { roll: true },
      100,
    );
    const second = reduceDiceRuntimeState(first, { roll: true }, 101);

    expect(first.rollId).not.toBeNull();
    expect(second.rollId).not.toBeNull();
    expect(second.rollId).not.toEqual(first.rollId);
  });

  it('builds a unique card pool inside the allowed subset', () => {
    const pool = buildAllowedCardPool(1, 3, ['hearts', 'spades'], 'custom');

    expect(pool).toHaveLength(6);
    expect(pool.every((card) => ['hearts', 'spades'].includes(card.suit ?? ''))).toBe(true);
    expect(pool[0]?.rankValue).toBe(1);
    expect(pool.at(-1)?.rankValue).toBe(3);
  });

  it('draws unique cards and emits validation when requested draw exceeds pool size', () => {
    jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.4)
      .mockReturnValueOnce(0.02)
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0.25);

    const state = reduceCardRuntimeState(
      parseCardRuntimeState({
        drawCount: 3,
        rankMin: 1,
        rankMax: 1,
        suitMode: 'custom',
        allowedSuits: ['hearts', 'spades'],
      }),
      { flip: true },
      200,
    );

    expect(state.cards).toHaveLength(2);
    expect(new Set(state.cards.map((card) => card.id)).size).toBe(2);
    expect(state.validationMessage).toContain('Only 2 cards available');
  });

  it('supports an explicit no-suit deck mode', () => {
    const state = parseCardRuntimeState({
      suitMode: 'none',
      allowedSuits: [],
    });

    expect(state.suitMode).toBe('none');
    expect(state.allowedSuits).toEqual([]);
  });

  it('supports versus card layouts with numeric ranks', () => {
    const state = reduceCardRuntimeState(
      parseCardRuntimeState({
        drawCount: 6,
        layoutMode: 'versus',
        rankMin: 1,
        rankMax: 10,
        rankStyle: 'numeric',
        suitMode: 'none',
      }),
      { flip: true },
      250,
      () => 0.4,
    );

    expect(state.layoutMode).toBe('versus');
    expect(state.rankStyle).toBe('numeric');
    expect(state.cards).toHaveLength(6);
    expect(state.cards.every((card) => card.suit === null)).toBe(true);
  });
});
