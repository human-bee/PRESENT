import { MODEL_KEY_PROVIDERS } from '@/lib/agents/shared/user-model-keys';
import {
  buildProviderStateMap,
  MODEL_KEY_PROVIDER_CONFIGS,
  MODEL_KEY_PROVIDER_UI_ORDER,
} from './model-key-provider-config';

describe('model-key-provider-config', () => {
  it('covers every model-key provider in the state-map helper', () => {
    const map = buildProviderStateMap((provider) => provider.toUpperCase());
    expect(Object.keys(map).sort()).toEqual([...MODEL_KEY_PROVIDERS].sort());
    expect(map.fal).toBe('FAL');
    expect(map.xai).toBe('XAI');
  });

  it('keeps UI configs aligned with the declared UI order', () => {
    expect(MODEL_KEY_PROVIDER_CONFIGS.map((provider) => provider.id)).toEqual(
      MODEL_KEY_PROVIDER_UI_ORDER,
    );
  });

  it('keeps the UI order in sync with the shared provider set', () => {
    expect([...MODEL_KEY_PROVIDER_UI_ORDER].sort()).toEqual([...MODEL_KEY_PROVIDERS].sort());
  });
});
