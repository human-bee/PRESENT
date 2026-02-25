import { getModelForSteward, normalizeFastStewardModel } from '@/lib/agents/fast-steward-config';
import { resolveModelControl } from './resolver';

type ResolveFastStewardModelInput = {
  steward: string;
  stewardEnvVar: string;
  room?: string;
  task?: string;
};

export async function resolveFastStewardModel(
  input: ResolveFastStewardModelInput,
): Promise<{ model: string; configVersion?: string }> {
  const fallbackModel = getModelForSteward(input.stewardEnvVar);
  try {
    const resolved = await resolveModelControl({
      task: input.task ?? `fast.${input.steward}`,
      room: input.room,
      includeUserScope: false,
    });
    const fastByStewardModel =
      resolved.effective.models?.fastBySteward?.[input.steward] ??
      resolved.effective.knobs?.fastStewards?.bySteward?.[input.steward];
    const fastDefaultModel =
      resolved.effective.models?.fastDefault ?? resolved.effective.knobs?.fastStewards?.defaultModel;
    const chosen = fastByStewardModel || fastDefaultModel || fallbackModel;
    return {
      model: normalizeFastStewardModel(chosen),
      configVersion: resolved.configVersion,
    };
  } catch {
    return { model: fallbackModel };
  }
}
