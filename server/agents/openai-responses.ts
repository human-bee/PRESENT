import { agentModels, agentNames, type CodexProvider, type GenerationOptions, type ProviderAvailability } from '../../shared/agent-models';
import { AgentError, widgetInstructions, widgetOutputSchema } from './contract';
import type { StructuredProfile } from './codex';

// Explicit operator opt-in: never fall back from a subscription to paid API calls.
export const usesOpenAIResponses = () => process.env.PRESENT_MODEL_TRANSPORT === 'openai';
const ids: CodexProvider[] = ['luna', 'terra', 'codex', 'spark'];
const efforts = (provider: CodexProvider) => provider === 'codex' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const maxBytes = 2_000_000;
const failure = (message = 'The OpenAI response was incomplete. Your canvas is unchanged.', status = 502) => new AgentError(message, status);
function requireSuccess(response: Response) {
  if (response.ok) return;
  if ([401, 403].includes(response.status)) throw failure('OpenAI API access was denied. Ask the server operator to check the key and model permissions.', 424);
  if (response.status === 429) throw failure('OpenAI usage or rate limit reached. Try again shortly or check the project limits.', 429);
  throw failure('OpenAI could not complete this request. Check the configured model, options and service status.');
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
async function boundedJSON(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw failure();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0; if (bytes > maxBytes) throw failure('The OpenAI response exceeded its size limit.');
      text += decoder.decode(value, { stream: !done }); if (done) break;
    }
    return record(JSON.parse(text));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function completedResponseText(response: Record<string, unknown>, model: string): string {
  const returned = response.model;
  // A dated snapshot of the requested alias is valid; another family never is.
  if (typeof returned !== 'string' || (returned !== model && !(returned.startsWith(`${model}-`) && /^\d{4}-\d{2}-\d{2}$/.test(returned.slice(model.length + 1))))) throw failure('OpenAI returned a different model. Your canvas is unchanged.');
  if (response.status !== 'completed' || response.error || !Array.isArray(response.output)) throw failure();
  let text = '';
  for (const rawItem of response.output) {
    const item = record(rawItem);
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) throw failure();
    for (const rawPart of item.content) {
      const part = record(rawPart);
      if (part.type === 'refusal') throw failure('The model declined this request. Your canvas is unchanged.', 422);
      if (part.type !== 'output_text' || typeof part.text !== 'string') throw failure();
      text += part.text;
    }
  }
  if (!text || text.length > 400000) throw failure();
  return text;
}
export async function readResponsesStream(response: Response, model: string, onDelta: (text: string) => void): Promise<string> {
  if (!response.body) throw failure();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', bytes = 0, previewLength = 0;
  const consume = (frame: string): string | undefined => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw failure();
    if (event.type === 'response.refusal.delta' || event.type === 'response.refusal.done') throw failure('The model declined this request. Your canvas is unchanged.', 422);
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      previewLength += event.delta.length; if (previewLength > 400000) throw failure();
      onDelta(event.delta); // Preview only: callers commit after validated terminal output.
    }
    if (event.type === 'response.completed') return completedResponseText(record(event.response), model);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0; if (bytes > maxBytes) throw failure('The OpenAI stream exceeded its size limit.');
      pending += decoder.decode(value, { stream: !done });
      for (;;) {
        const separator = /\r?\n\r?\n/.exec(pending);
        if (!separator) break;
        const frame = pending.slice(0, separator.index); pending = pending.slice(separator.index + separator[0].length);
        const text = consume(frame); if (text !== undefined) return text;
      }
      if (done) { if (pending) { const text = consume(pending); if (text !== undefined) return text; } break; }
    }
    throw failure();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function generateWithOpenAI(prompt: string, signal: AbortSignal, provider: CodexProvider = 'luna', profile?: StructuredProfile, options: GenerationOptions = {}): Promise<string> {
  if (!usesOpenAIResponses()) throw failure('OpenAI API planning requires explicit PRESENT_MODEL_TRANSPORT=openai configuration.', 503);
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw failure('OpenAI is not configured on this server.', 503);
  if (provider === 'spark') throw failure('Spark requires the Codex app-server transport.', 400);
  const effort = options.reasoning ?? 'low';
  if (!efforts(provider).includes(effort)) throw failure('This model does not support the selected API reasoning effort.', 400);
  signal.throwIfAborted();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: agentModels[provider], store: false, stream: !!profile?.onDelta, max_output_tokens: 20000,
      instructions: profile?.instructions ?? widgetInstructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...(profile?.image ? [{ type: 'input_image', image_url: profile.image, detail: 'auto' }] : [])] }],
      reasoning: { effort }, service_tier: options.fast ? 'fast' : 'default', tools: [],
      text: { format: { type: 'json_schema', name: 'present_result', strict: true, schema: profile?.outputSchema ?? widgetOutputSchema } },
    }),
  });
  requireSuccess(response);
  const text = profile?.onDelta ? await readResponsesStream(response, agentModels[provider], profile.onDelta) : completedResponseText(await boundedJSON(response), agentModels[provider]);
  signal.throwIfAborted();
  return text;
}

let discovery: { key: string; until: number; pending: Promise<{ models: Set<string>; reason?: string }> } | undefined;
export async function openAIAvailability(): Promise<{ providers: ProviderAvailability[] }> {
  const key = process.env.OPENAI_API_KEY;
  let models = new Set<string>(), reason = 'OpenAI API key not configured.';
  if (!usesOpenAIResponses()) reason = 'OpenAI Responses transport is not enabled.';
  else if (key) {
    if (!discovery || discovery.key !== key || discovery.until < Date.now()) discovery = { key, until: Date.now() + 60000, pending: (async () => {
      try {
        const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
        requireSuccess(response); const data = await boundedJSON(response);
        return { models: new Set<string>((Array.isArray(data.data) ? data.data : []).flatMap((item: { id?: unknown }) => typeof item.id === 'string' ? [item.id] : [])) };
      } catch { return { models: new Set<string>(), reason: 'OpenAI model access could not be verified. Check the key, project permissions and connection.' }; }
    })() };
    const result = await discovery.pending; models = result.models; reason = result.reason ?? 'This model is not available to this API project.';
  }
  return { providers: ids.map(id => ({ id, name: agentNames[id], model: agentModels[id], configured: id !== 'spark' && models.has(agentModels[id]),
    reasoning: id === 'spark' ? [] : efforts(id), fast: id !== 'spark' && models.has(agentModels[id]),
    fastDescription: 'OpenAI API usage is billed to the configured project. Fast requests the paid Fast tier; availability and latency still need verification.',
    reason: id === 'spark' ? 'Spark requires the Codex app-server transport.' : models.has(agentModels[id]) ? undefined : reason })) };
}
