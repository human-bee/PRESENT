import { z } from 'zod';
// Legacy IDs remain readable in saved jobs; they are never remapped to a current model.
export const agentModels = { sol: 'gpt-6.1-sol', luna: 'gpt-6-luna', codex: 'gpt-6-astra', spark: 'gpt-5.3-codex-spark', terra: 'gpt-5.6-terra', cerebras: 'qwen-3.8-27b' } as const;
export const agentNames = { sol: 'Sol 6.1', luna: 'Luna 6', codex: 'Astra 6', spark: 'Spark (retired)', terra: 'Terra (legacy)', cerebras: 'Qwen 3.8 · Cerebras' };
export const providerSchema = z.enum(['sol', 'luna', 'codex', 'cerebras', 'spark', 'terra']);
export type AgentProvider = z.infer<typeof providerSchema>;
export type CodexProvider = Exclude<AgentProvider, 'cerebras'>;
export const currentCodexProviders = ['sol', 'luna', 'codex'] as const satisfies readonly CodexProvider[];
export const isCurrentCodexProvider = (provider: CodexProvider): boolean => (currentCodexProviders as readonly string[]).includes(provider);
export const reasoningSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const generationOptionsSchema = z.object({ reasoning: reasoningSchema.optional(), fast: z.boolean().optional(), decisions: z.enum(['jev', 'off']).optional() });
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;
export type ProviderAvailability = { id: AgentProvider; name: string; model: string; configured: boolean; reasoning: string[]; fast: boolean; fastDescription?: string; reason?: string };

/** A stored choice is a preference, never an instruction to silently choose another model. */
export function readProviderPreference(raw: unknown): AgentProvider | undefined {
  const parsed = providerSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
export function providerUnavailableReason(provider: AgentProvider, providers: readonly ProviderAvailability[]): string | undefined {
  if (provider === 'spark' || provider === 'terra') return 'This saved model is unavailable. Choose Sol, Luna or Astra explicitly.';
  const selected = providers.find(item => item.id === provider);
  if (selected && !selected.configured) return selected.reason ?? 'The selected model is unavailable. Choose an available model in settings.';
  if (providers.length && !selected) return 'The selected model is unavailable. Choose an available model in settings.';
  return undefined; // Discovery has not returned yet.
}
