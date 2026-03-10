import type { VoiceRealtimeConfig } from './config';

export type VoiceRuntimeModelIdentity = {
  provider: 'openai';
  model: string;
  providerPath: 'primary';
  providerSource: 'runtime_selected';
};

export const createVoiceRuntimeModelIdentity = (
  realtimeConfig: Pick<VoiceRealtimeConfig, 'resolvedRealtimeModel'>,
): VoiceRuntimeModelIdentity => ({
  provider: 'openai',
  model: realtimeConfig.resolvedRealtimeModel,
  providerPath: 'primary',
  providerSource: 'runtime_selected',
});
