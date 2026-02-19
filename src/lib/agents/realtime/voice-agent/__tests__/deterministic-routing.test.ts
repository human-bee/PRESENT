import { isDeterministicCanvasCommand } from '../deterministic-routing';

describe('isDeterministicCanvasCommand', () => {
  it('matches structured coordinate instructions', () => {
    expect(
      isDeterministicCanvasCommand(
        'Use multiple fairies to ensure one ground strip exists with id forest-ground as a green rectangle at x=-240 y=170 w=500 h=8.',
      ),
    ).toBe(true);
  });

  it('matches explicit deterministic shape ids', () => {
    expect(
      isDeterministicCanvasCommand(
        'Draw bunny-ear-left from -30,-160 to -20,-60 and sticky-bunny at x=130 y=-70.',
      ),
    ).toBe(true);
  });

  it('does not match non-geometry conversational prompts', () => {
    expect(isDeterministicCanvasCommand('Can you summarize what changed in the scorecard?')).toBe(false);
  });
});
