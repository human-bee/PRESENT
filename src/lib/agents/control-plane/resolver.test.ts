jest.mock('./profiles', () => ({
  getModelControlProfilesForResolution: jest.fn(async () => []),
}));

describe('model-control resolver apply modes', () => {
  const originalTurnDetection = process.env.VOICE_AGENT_TURN_DETECTION;
  const originalRealtimeModel = process.env.VOICE_AGENT_REALTIME_MODEL;

  afterEach(() => {
    if (typeof originalTurnDetection === 'undefined') {
      delete process.env.VOICE_AGENT_TURN_DETECTION;
    } else {
      process.env.VOICE_AGENT_TURN_DETECTION = originalTurnDetection;
    }

    if (typeof originalRealtimeModel === 'undefined') {
      delete process.env.VOICE_AGENT_REALTIME_MODEL;
    } else {
      process.env.VOICE_AGENT_REALTIME_MODEL = originalRealtimeModel;
    }

    jest.resetModules();
  });

  it('marks voice knobs and voice models as next_session', async () => {
    process.env.VOICE_AGENT_TURN_DETECTION = 'server_vad';
    process.env.VOICE_AGENT_REALTIME_MODEL = 'gpt-realtime-1.5';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveModelControl } = require('./resolver');
    const resolved = await resolveModelControl({ task: 'voice.realtime' }, { skipCache: true });

    expect(resolved.applyModes['knobs.voice.turnDetection']).toBe('next_session');
    expect(resolved.applyModes['models.voiceRealtime']).toBe('next_session');
  });
});
