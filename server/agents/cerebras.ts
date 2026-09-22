import { readCompletionStream } from './completion-stream';
import { AgentError, widgetInstructions, widgetOutputSchema } from './contract';
import { agentModels, type GenerationOptions } from '../../shared/agent-models';
import type { StructuredProfile } from './codex';

export async function generateWithCerebras(prompt: string, signal: AbortSignal, profile?: StructuredProfile, options: GenerationOptions = {}): Promise<string> {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) throw new AgentError('Cerebras is not configured on this server.', 503);
  const effort = options.reasoning ?? 'low';
  if (!['none', 'low', 'medium', 'high'].includes(effort)) throw new AgentError('Qwen supports none, low, medium or high reasoning.', 400);
  if (options.fast) throw new AgentError('The Codex Fast tier does not apply to Cerebras.', 400);
  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stream: !!profile?.onDelta, model: agentModels.cerebras, messages: [{ role: 'system', content: profile?.instructions ?? widgetInstructions }, { role: 'user', content: prompt }], max_completion_tokens: 20000, reasoning_effort: effort, response_format: { type: 'json_schema', json_schema: { name: 'present_result', strict: true, schema: profile?.outputSchema ?? widgetOutputSchema } } }),
  });
  if (response.status === 401) throw new AgentError('Cerebras rejected the API key. Update CEREBRAS_API_KEY with an active key from your credited account.', 401);
  if (response.status === 402) throw new AgentError('Cerebras needs billing credit. Choose Luna in room settings to use your Codex subscription.', 402);
  if (!response.ok) throw new AgentError(response.status === 429 ? 'Cerebras is busy. Try again shortly.' : 'Cerebras could not create this widget. Check the server connection.', response.status === 429 ? 429 : 502);
  if (profile?.onDelta) return readCompletionStream(response, profile.onDelta);
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || body.choices?.[0]?.finish_reason === 'length') throw new AgentError('The widget was incomplete. Try a smaller request.');
  return text;
}
