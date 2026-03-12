import {
  buildFairyCanvasModelRequest,
  clearStoredFairyCanvasModel,
  normalizeFairyCanvasModelId,
  readStoredFairyCanvasModel,
  resetFairyCanvasModelSelectionIfUnavailable,
  shouldResetFairyCanvasModelSelection,
  writeStoredFairyCanvasModel,
} from './fairy-canvas-model-selection';

describe('fairy canvas model selection', () => {
  beforeEach(() => {
    window.localStorage.removeItem('present:fairy:canvas-model');
  });

  it('normalizes only the benchmarked fairy canvas models', () => {
    expect(normalizeFairyCanvasModelId('gpt5.4-low')).toBe('gpt-5.4');
    expect(normalizeFairyCanvasModelId('cerebras:gpt-oss-120b')).toBe('gpt-oss-120b');
    expect(normalizeFairyCanvasModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(normalizeFairyCanvasModelId('claude-sonnet-4-5')).toBeNull();
  });

  it('persists and clears the selected model', () => {
    expect(writeStoredFairyCanvasModel('gpt-5.4')).toBe('gpt-5.4');
    expect(readStoredFairyCanvasModel()).toBe('gpt-5.4');

    expect(clearStoredFairyCanvasModel()).toBeNull();
    expect(readStoredFairyCanvasModel()).toBeNull();
  });

  it('builds a canonical model and provider pair', () => {
    expect(buildFairyCanvasModelRequest('claude-haiku-4-5')).toEqual({
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
    });
    expect(buildFairyCanvasModelRequest('gpt-oss-120b')).toEqual({
      model: 'gpt-oss-120b',
      provider: 'cerebras',
    });
  });

  it('detects unavailable-model failures that should reset sticky selection', () => {
    expect(shouldResetFairyCanvasModelSelection('Unsupported or unavailable canvas model: gpt-oss-120b')).toBe(
      true,
    );
    expect(shouldResetFairyCanvasModelSelection('Provider not configured: cerebras')).toBe(true);
    expect(shouldResetFairyCanvasModelSelection('Queue unavailable')).toBe(false);
  });

  it('clears sticky selection when an unavailable-model failure occurs', () => {
    writeStoredFairyCanvasModel('gpt-oss-120b');

    expect(
      resetFairyCanvasModelSelectionIfUnavailable('Unsupported or unavailable canvas model: gpt-oss-120b'),
    ).toBe(true);
    expect(readStoredFairyCanvasModel()).toBeNull();
  });
});
