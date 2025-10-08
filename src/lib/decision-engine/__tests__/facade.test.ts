import { decide } from '..';
import { DecisionEngine } from '../../decision-engine';

describe('decision engine facade', () => {
  const apiKey = 'test-key';

  it('matches pipeline output with facade decide()', () => {
    const input = 'Create a timer component for 5 minutes';
    const config = {};

    const facadePlan = decide(input, config);
    const engine = new DecisionEngine(apiKey, config);
    const { plan } = engine.pipeline(input);

    expect(plan).toEqual(facadePlan);
  });
});
