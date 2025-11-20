import type { Streaming } from '../../../../vendor/tldraw-agent-template/shared/types/Streaming';
import type { AgentAction } from '../../../../vendor/tldraw-agent-template/shared/types/AgentAction';
import { AgentService } from '../../../../vendor/tldraw-agent-template/worker/do/AgentService';
import { buildTeacherPrompt, type TeacherPromptContext } from './prompt';

let serviceSingleton: AgentService | null = null;

const ensureEnvKey = (value: string | undefined): string | undefined =>
  value && value.trim().length > 0 ? value : undefined;

const createService = (): AgentService => {
  const openaiKey = ensureEnvKey(process.env.OPENAI_API_KEY);
  const anthropicKey = ensureEnvKey(process.env.ANTHROPIC_API_KEY);
  const googleKey = ensureEnvKey(process.env.GOOGLE_API_KEY);
  if (!openaiKey && !anthropicKey && !googleKey) {
    throw new Error('Teacher agent requires at least one model API key (OpenAI, Anthropic, or Google).');
  }
  const env = {
    OPENAI_API_KEY: openaiKey ?? '',
    ANTHROPIC_API_KEY: anthropicKey ?? '',
    GOOGLE_API_KEY: googleKey ?? '',
  } as any;
  return new AgentService(env);
};

const getService = (): AgentService => {
  if (!serviceSingleton) {
    serviceSingleton = createService();
  }
  return serviceSingleton;
};

export async function* streamTeacherAgent(
  context: TeacherPromptContext,
): AsyncGenerator<Streaming<AgentAction>> {
  const prompt = buildTeacherPrompt(context);
  const service = getService();
  for await (const event of service.stream(prompt)) {
    yield event;
  }
}
