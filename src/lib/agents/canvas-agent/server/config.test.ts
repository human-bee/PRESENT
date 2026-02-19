import { loadCanvasAgentConfig } from './config';

describe('loadCanvasAgentConfig', () => {
  it('uses a low-action followup default of 1 mutating action', () => {
    const cfg = loadCanvasAgentConfig({});
    expect(cfg.followups.lowActionThreshold).toBe(1);
  });

  it('allows explicit low-action threshold override', () => {
    const cfg = loadCanvasAgentConfig({ CANVAS_AGENT_LOW_ACTION_THRESHOLD: '0' });
    expect(cfg.followups.lowActionThreshold).toBe(0);
  });
});
