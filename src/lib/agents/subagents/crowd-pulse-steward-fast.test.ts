import {
  normalizeCrowdPulseActiveQuestionInput,
  parseCrowdPulseFallbackInstruction,
  shouldClearCrowdPulseQuestion,
} from './crowd-pulse-parser';

describe('parseCrowdPulseFallbackInstruction', () => {
  it('parses hand count, q_and_a status, and active question', () => {
    const patch = parseCrowdPulseFallbackInstruction(
      'Update CrowdPulse hand count to 17, status Q&A, add question: What blocks GA?',
    );

    expect(patch.handCount).toBe(17);
    expect(patch.status).toBe('q_and_a');
    expect(patch.activeQuestion).toBe('What blocks GA?');
  });

  it('parses word-based counts and confidence percentages', () => {
    const patch = parseCrowdPulseFallbackInstruction(
      'Update crowd pulse hand count to twelve, confidence 78%, question Can we ship Friday?',
    );

    expect(patch.handCount).toBe(12);
    expect(patch.confidence).toBeCloseTo(0.78, 5);
    expect(patch.activeQuestion).toBe('Can we ship Friday?');
  });

  it('extracts an inline question when no explicit question key is present', () => {
    const patch = parseCrowdPulseFallbackInstruction(
      "Update Crowdpulse. What's the launch hold point?",
    );

    expect(patch.activeQuestion).toBe("What's the launch hold point?");
  });

  it('falls back to prompt when no structured fields are detected', () => {
    const patch = parseCrowdPulseFallbackInstruction('Sync crowd pulse context from transcript.');

    expect(patch).toEqual({
      prompt: 'Sync crowd pulse context from transcript.',
    });
  });

  it('treats explicit question-clear instructions as an empty activeQuestion patch', () => {
    const patch = parseCrowdPulseFallbackInstruction('Clear the crowd pulse question now.');
    expect(patch.activeQuestion).toBe('');
    expect(shouldClearCrowdPulseQuestion('Clear the crowd pulse question now.')).toBe(true);
  });

  it('does not treat blank activeQuestion as clear without explicit clear intent', () => {
    expect(normalizeCrowdPulseActiveQuestionInput('   ', 'Update crowd pulse question')).toBeUndefined();
    expect(normalizeCrowdPulseActiveQuestionInput('   ', 'Clear the question prompt')).toBe('');
  });
});
