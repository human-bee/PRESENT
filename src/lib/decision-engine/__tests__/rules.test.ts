import { normalizeTranscript } from '../core/normalize';
import { detectIntent, evaluateRules } from '../core/rules';
import type { DecisionEngineConfig } from '../core/types';

describe('rules', () => {
  const config: DecisionEngineConfig = {};

  it('detects youtube intent', () => {
    const normalized = normalizeTranscript('Can you find the latest YouTube tutorial about Vue?');
    const result = detectIntent(normalized, config);
    expect(result.intent).toBe('youtube_search');
    expect(result.structuredContext?.wantsLatest).toBe(true);
  });

  it('detects ui component intent', () => {
    const normalized = normalizeTranscript('Please add a timer component to the dashboard');
    const result = detectIntent(normalized, config);
    expect(result.intent).toBe('ui_component');
  });

  it('falls back to general intent', () => {
    const normalized = normalizeTranscript('How is everyone doing today?');
    const result = detectIntent(normalized, config);
    expect(result.intent).toBe('general');
  });

  it('evaluates single word and actionable keywords', () => {
    const singleWord = normalizeTranscript('Hello');
    expect(evaluateRules(singleWord).isSingleWord).toBe(true);

    const actionable = normalizeTranscript('Please create a chart for sales data');
    expect(evaluateRules(actionable).hasDecisionKeyword).toBe(true);
  });
});
