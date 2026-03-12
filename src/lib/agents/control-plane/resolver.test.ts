jest.mock('./profiles', () => ({
  getModelControlProfilesForResolution: jest.fn(async () => []),
}));

import { clearModelControlResolverCache, resolveModelControl } from './resolver';

const ENV_KEYS = [
  'VOICE_AGENT_REALTIME_MODEL',
  'VOICE_AGENT_REALTIME_MODEL_PRIMARY',
  'VOICE_AGENT_REALTIME_MODEL_SECONDARY',
] as const;

describe('model control resolver env defaults', () => {
  const originalEnv: Record<string, string | undefined> = {
    VOICE_AGENT_REALTIME_MODEL: process.env.VOICE_AGENT_REALTIME_MODEL,
    VOICE_AGENT_REALTIME_MODEL_PRIMARY: process.env.VOICE_AGENT_REALTIME_MODEL_PRIMARY,
    VOICE_AGENT_REALTIME_MODEL_SECONDARY: process.env.VOICE_AGENT_REALTIME_MODEL_SECONDARY,
  };

  afterEach(() => {
    clearModelControlResolverCache();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('does not force an explicit voiceRealtime model when only primary/secondary defaults apply', async () => {
    delete process.env.VOICE_AGENT_REALTIME_MODEL;
    process.env.VOICE_AGENT_REALTIME_MODEL_PRIMARY = 'gpt-realtime-1.5';
    process.env.VOICE_AGENT_REALTIME_MODEL_SECONDARY = 'gpt-realtime-mini';

    const resolved = await resolveModelControl(
      {
        task: 'voice.realtime',
        room: 'room-a',
        includeUserScope: false,
      },
      { skipCache: true },
    );

    expect(resolved.effective.models?.voiceRealtime).toBeUndefined();
    expect(resolved.effective.models?.voiceRealtimePrimary).toBe('gpt-realtime-1.5');
    expect(resolved.effective.models?.voiceRealtimeSecondary).toBe('gpt-realtime-mini');
  });

  it('preserves explicit voiceRealtime override when configured', async () => {
    process.env.VOICE_AGENT_REALTIME_MODEL = 'gpt-realtime-1.5';

    const resolved = await resolveModelControl(
      {
        task: 'voice.realtime',
        room: 'room-a',
        includeUserScope: false,
      },
      { skipCache: true },
    );

    expect(resolved.effective.models?.voiceRealtime).toBe('gpt-realtime-1.5');
  });
});
