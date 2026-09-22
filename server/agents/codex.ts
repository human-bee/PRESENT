import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { AgentError, agentModels, widgetInstructions, widgetOutputSchema } from './contract';
import { CodexWire, record, type WireMessage } from './codex-wire';

import { agentNames, type CodexProvider, type GenerationOptions, type ProviderAvailability } from '../../shared/agent-models';
type Model = { id: string; model: string; serviceTiers?: { id: string; name: string; description: string }[]; supportedReasoningEfforts: { reasoningEffort: string }[] };
type Session = { wire: CodexWire; models: Model[]; users: number; idle?: ReturnType<typeof setTimeout> };
let session: Promise<Session> | undefined;
let activeWire: CodexWire | undefined;
export function codexCommand(): string | null {
  const candidates = process.env.CODEX_CLI_PATH ? [process.env.CODEX_CLI_PATH] : (process.env.PATH ?? '').split(delimiter).map(p => join(p, 'codex'));
  return candidates.find(p => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } }) ?? null;
}
export function codexConfigured(): boolean {
  const auth = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  try { return !!codexCommand() && record(JSON.parse(readFileSync(auth, 'utf8'))).auth_mode === 'chatgpt'; } catch { return false; }
}
const disabledFeatures = ['shell_tool', 'unified_exec', 'apply_patch_freeform', 'view_image', 'apps', 'connectors', 'plugins', 'remote_plugin', 'browser_use', 'computer_use', 'js_repl', 'code_mode', 'multi_agent', 'multi_agent_v2', 'memories', 'memory_tool', 'skill_search', 'tool_search', 'image_generation', 'workspace_dependencies'];

/** Verified against Codex 0.153.4: an empty environment list disables all host access. */
export type StructuredProfile = { instructions: string; outputSchema: object; image?: string; onDelta?: (chunk: string) => void };
export const codexThreadOptions = (provider: CodexProvider = 'codex', profile?: StructuredProfile) => ({
  model: agentModels[provider], allowProviderModelFallback: false, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never',
  environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [], dynamicTools: [],
  developerInstructions: profile?.instructions ?? widgetInstructions,
  config: { web_search: 'disabled', project_doc_max_bytes: 0, mcp_servers: {}, features: Object.fromEntries([...disabledFeatures.map(name => [name, false]), ['skip_host_skill_discovery', true]]) },
});

function release(current: Session) {
  current.users--;
  if (!current.users) { current.idle = setTimeout(() => { current.wire.close(); if (activeWire === current.wire) session = undefined; }, 120000); current.idle.unref(); }
}
async function acquire(): Promise<Session> {
  if (!session) session = (async () => {
    const command = codexCommand();
    if (!command || !codexConfigured()) throw new AgentError('Sign in to the local Codex app with ChatGPT to use Spark or Astra.', 503);
    const wire = new CodexWire(command); activeWire = wire;
    try {
      await wire.request('initialize', { clientInfo: { name: 'present_widget', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      wire.send({ method: 'initialized' });
      const account = await wire.request<{ account: { type: string } | null }>('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') throw new AgentError('This adapter requires a ChatGPT Codex subscription.', 503);
      const models: Model[] = []; let cursor: string | null = null;
      do {
        const page: { data: Model[]; nextCursor: string | null } = await wire.request('model/list', { includeHidden: true, limit: 100, cursor });
        models.push(...page.data); cursor = page.nextCursor;
      } while (cursor);
      return { wire, models, users: 0 };
    } catch (error) { wire.close(); throw error; }
  })();
  let current: Session;
  try { current = await session; } catch (error) { session = undefined; throw error; }
  if (current.wire.closed) { session = undefined; return acquire(); }
  clearTimeout(current.idle); current.users++; return current;
}
export async function closeCodexSession() {
  const pending = session; session = undefined;
  try { const current = await pending; if (current) { clearTimeout(current.idle); current.wire.close(); } } catch { /* Initialization already failed. */ }
}
process.once('exit', () => activeWire?.close());

export async function codexAvailability(): Promise<{ spark: boolean; codex: boolean; providers: ProviderAvailability[]; reason?: string }> {
  const ids: CodexProvider[] = ['luna', 'terra', 'codex', 'spark'];
  let models: Model[] = [], reason: string | undefined;
  try { const current = await acquire(); models = current.models; release(current); }
  catch (error) { reason = error instanceof Error ? error.message : 'Codex availability could not be checked.'; }
  const providers = ids.map(id => {
    const model = models.find(m => m.model === agentModels[id]);
    const tier = model?.serviceTiers?.find(t => t.id === 'priority');
    return { id, name: agentNames[id], model: agentModels[id], configured: !!model,
      reasoning: model?.supportedReasoningEfforts.map(e => e.reasoningEffort) ?? [], fast: !!tier,
      fastDescription: tier?.description, reason: model ? undefined : reason ?? 'Not available to this Codex account.' };
  });
  return { spark: providers.some(p => p.id === 'spark' && p.configured), codex: providers.some(p => p.id === 'codex' && p.configured), providers, reason };
}

export async function generateWithCodex(prompt: string, signal: AbortSignal, provider: CodexProvider = 'codex', profile?: StructuredProfile, options: GenerationOptions = {}): Promise<string> {
  if (signal.aborted) throw new AgentError('Widget generation was cancelled.', 408);
  const current = await acquire(); const { wire } = current;
  let threadId: string | undefined; let turnId: string | undefined;
  let listener: ((message: WireMessage) => void) | undefined;
  let rejectCompletion: (error: Error) => void = () => {};
  const abort = () => rejectCompletion(new AgentError('Widget generation was cancelled.', 408));
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new AgentError('Widget generation was cancelled.', 408);
    const model = current.models.find(m => m.model === agentModels[provider]);
    if (!model) throw new AgentError(`${agentModels[provider]} is not available to this Codex account.`, 503);
    const effort = options.reasoning ?? 'low';
    if (!model.supportedReasoningEfforts.some(e => e.reasoningEffort === effort)) throw new AgentError(`${agentModels[provider]} does not support ${effort} reasoning.`, 400);
    if (options.fast && !model.serviceTiers?.some(t => t.id === 'priority')) throw new AgentError('Fast mode is unavailable for this model.', 400);
    const serviceTier = options.fast ? 'priority' : 'default';
    const started = await wire.request<{ thread: { id: string }; model: string }>('thread/start', { ...codexThreadOptions(provider, profile), serviceTier });
    threadId = started.thread.id;
    if (started.model !== agentModels[provider]) throw new AgentError('Codex selected a different model. The widget was not generated.', 503);
    if (signal.aborted) throw new AgentError('Widget generation was cancelled.', 408);
    let result = ''; const early: WireMessage[] = [];
    const completion = new Promise<string>((resolve, reject) => {
      rejectCompletion = reject;
      listener = message => {
        if (message.method === 'closed') { reject(new AgentError('Codex transport closed during generation.')); return; }
        const params = record(message.params);
        if (params.threadId !== threadId) return;
        if (!turnId) { if (early.length < 128) early.push(message); return; }
        const turn = record(params.turn); const item = record(params.item);
        if ((params.turnId ?? turn.id) !== turnId) return;
        if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') profile?.onDelta?.(params.delta);
        if (message.method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string' && item.phase !== 'commentary') result = item.text;
        if (message.method === 'error' && params.willRetry === false) {
          const error = new AgentError(`Codex ${provider} turn failed. Your room is unchanged.`); error.cause = params.error; reject(error);
        }
        if (message.method === 'turn/completed') {
          if (turn.status === 'completed' && result) resolve(result);
          else reject(new AgentError(`Codex ${provider} turn ${typeof turn.status === 'string' ? turn.status : 'failed'}. Your room is unchanged.`));
        }
      };
      wire.listeners.add(listener);
    });
    void completion.catch(() => {});
    const turn = await wire.request<{ turn: { id: string } }>('turn/start', { threadId, environments: [], input: [{ type: 'text', text: prompt, text_elements: [] }, ...(profile?.image ? [{ type: 'image', url: profile.image }] : [])], effort, serviceTierForTurn: serviceTier, outputSchema: profile?.outputSchema ?? widgetOutputSchema });
    turnId = turn.turn.id;
    for (const message of early) listener?.(message);
    if (signal.aborted) abort();
    return await completion;
  } finally {
    signal.removeEventListener('abort', abort);
    if (listener) wire.listeners.delete(listener);
    if (threadId && !wire.closed) {
      try {
        if (turnId && signal.aborted) await wire.request('turn/interrupt', { threadId, turnId }, 5000);
        await wire.request('thread/unsubscribe', { threadId }, 5000);
      } catch { wire.close(); }
    }
    release(current);
  }
}
