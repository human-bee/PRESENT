import { DEFAULT_VOICE_REALTIME_MODEL, resolveVoiceRealtimeConfig } from '../config';
import { createVoiceRuntimeModelIdentity } from '../runtime-model';

const envOf = (patch: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({
    ...patch,
  }) as NodeJS.ProcessEnv;

describe('voice runtime model identity', () => {
  it('matches the session model selected by realtime config', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        REALTIME_MODEL: 'gpt-realtime',
        VOICE_AGENT_REALTIME_MODEL: 'gpt-realtime-1.5',
      }),
    );

    const identity = createVoiceRuntimeModelIdentity(config);

    expect(identity).toEqual({
      provider: 'openai',
      model: config.resolvedRealtimeModel,
      providerPath: 'primary',
      providerSource: 'runtime_selected',
    });
    expect(identity.model).toBe('gpt-realtime-1.5');
  });

  it('stays aligned with the explicit default when only legacy REALTIME_MODEL is present', () => {
    const config = resolveVoiceRealtimeConfig(
      envOf({
        REALTIME_MODEL: 'gpt-realtime',
      }),
    );

    const identity = createVoiceRuntimeModelIdentity(config);

    expect(config.resolvedRealtimeModel).toBe(DEFAULT_VOICE_REALTIME_MODEL);
    expect(identity.model).toBe(config.resolvedRealtimeModel);
  });
});
