import { modelProfileSchema, type ModelProfile } from '@present/contracts';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';
import { RESET_ID_PREFIXES, createResetId } from './ids';

const baseProfile = (input: Omit<ModelProfile, 'id'>) =>
  modelProfileSchema.parse({
    ...input,
    id: createResetId(RESET_ID_PREFIXES.modelProfile),
  });

export const DEFAULT_MODEL_PROFILES = [
  baseProfile({
    role: 'planner',
    provider: 'openai',
    model: 'gpt-5.4',
    label: 'Planner',
    source: 'default',
    default: true,
    latencyClass: 'deep',
    supports: ['planning', 'review', 'refactor'],
    metadata: { lane: 'default_complex_turn' },
  }),
  baseProfile({
    role: 'executor',
    provider: 'openai',
    model: 'gpt-5.3-codex',
    label: 'Executor',
    source: 'default',
    default: true,
    latencyClass: 'interactive',
    supports: ['file_edits', 'command_execution', 'tests'],
    metadata: { lane: 'long_running_code' },
  }),
  baseProfile({
    role: 'reviewer',
    provider: 'openai',
    model: 'gpt-5.4',
    label: 'Reviewer',
    source: 'default',
    default: true,
    latencyClass: 'deep',
    supports: ['review', 'risk_assessment'],
    metadata: { lane: 'review' },
  }),
  baseProfile({
    role: 'widget',
    provider: 'openai',
    model: 'gpt-5.3-codex-spark',
    label: 'Widget Builder',
    source: 'default',
    default: true,
    latencyClass: 'instant',
    supports: ['html_widget', 'iframe_bundle'],
    metadata: { lane: 'fast_ui' },
  }),
  baseProfile({
    role: 'realtime',
    provider: 'openai',
    model: 'gpt-realtime-1.5',
    label: 'Realtime',
    source: 'control_plane',
    default: true,
    latencyClass: 'instant',
    supports: ['voice', 'room_presence'],
    metadata: { lane: 'voice_room' },
  }),
];

export async function resolveKernelModelProfiles(input: {
  task?: string;
  room?: string;
  userId?: string;
  billingUserId?: string;
} = {}) {
  let resolved:
    | Awaited<ReturnType<typeof resolveModelControl>>
    | null = null;

  try {
    resolved = await resolveModelControl({
      task: input.task,
      room: input.room,
      userId: input.userId,
      billingUserId: input.billingUserId,
    });
  } catch {
    resolved = null;
  }

  return DEFAULT_MODEL_PROFILES.map((profile) => {
    if (profile.role === 'search' && resolved?.effective.models?.searchModel) {
      return modelProfileSchema.parse({
        ...profile,
        provider: 'openai',
        model: resolved.effective.models.searchModel,
        source: 'control_plane',
      });
    }
    if (profile.role === 'realtime' && resolved?.effective.models?.voiceRealtime) {
      return modelProfileSchema.parse({
        ...profile,
        provider: 'openai',
        model: resolved.effective.models.voiceRealtime,
        source: 'control_plane',
      });
    }
    return profile;
  });
}
