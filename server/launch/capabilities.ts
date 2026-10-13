import { agentModels, agentNames, currentCodexProviders, type ProviderAvailability } from '../../shared/agent-models';
import { codexCommand, codexConfigured, discoverCodexModels, type CodexModel } from '../agents/codex';
import { CodexWire } from '../agents/codex-wire';
import { openAIAvailability, usesOpenAIResponses } from '../agents/openai-responses';

type WorkspaceProbe = { configured: boolean; authenticated: boolean; models: CodexModel[]; reason?: string };
const providersFor = (models: CodexModel[], reason?: string): ProviderAvailability[] => currentCodexProviders.map(id => {
  const model = models.find(item => item.model === agentModels[id] && !item.hidden);
  const tier = model?.serviceTiers?.find(item => item.id === 'priority');
  return { id, name: agentNames[id], model: agentModels[id], configured: !!model, reasoning: model?.supportedReasoningEfforts.map(item => item.reasoningEffort) ?? [], fast: !!tier, ...(tier?.description ? { fastDescription: tier.description } : {}), ...(!model ? { reason: reason ?? 'This model is unavailable to the configured Codex account.' } : {}) };
});
let cached: { key: string; until: number; pending: Promise<WorkspaceProbe> } | undefined;
/** Account/catalog reads only. Never create a thread, workspace or model turn. */
export async function probeWorkspaceExecutor(): Promise<WorkspaceProbe> {
  const command = codexCommand();
  if (!command || !codexConfigured()) return { configured: false, authenticated: false, models: [], reason: 'Workspace execution requires a configured Codex app-server and ChatGPT sign-in; an API planning key does not provide it.' };
  const key = `${command}:${process.env.CODEX_HOME ?? ''}`;
  if (cached?.key === key && cached.until > Date.now()) return cached.pending;
  const pending = (async (): Promise<WorkspaceProbe> => {
    const wire = new CodexWire(command), timer = setTimeout(() => wire.close(), 8000);
    let authenticated = false;
    try {
      await wire.request('initialize', { clientInfo: { name: 'present_capabilities', version: '0.1.0' }, capabilities: { experimentalApi: true } }, 2000);
      wire.send({ method: 'initialized' });
      const account = await wire.request<{ account: { type: string } | null }>('account/read', { refreshToken: false }, 2000);
      authenticated = account.account?.type === 'chatgpt';
      if (!authenticated) return { configured: true, authenticated: false, models: [], reason: 'The configured executor did not confirm a ChatGPT account.' };
      const models = await discoverCodexModels({ request: (method, params) => wire.request(method, params, 2000) });
      return { configured: true, authenticated, models };
    } catch { return { configured: true, authenticated, models: [], reason: 'Executor account or model discovery could not be verified. Check the configured runtime and sign-in.' }; }
    finally { clearTimeout(timer); wire.close(); await wire.stopped; }
  })();
  cached = { key, until: Date.now() + 30000, pending }; return pending;
}

type Discovery = { workspace?: () => Promise<WorkspaceProbe>; planning?: typeof openAIAvailability };
export async function discoverLaunchCapabilities(options: Discovery = {}) {
  const workspace = await (options.workspace ?? probeWorkspaceExecutor)();
  const workspaceProviders = providersFor(workspace.models, workspace.reason);
  const openai = usesOpenAIResponses();
  const planning = openai ? await (options.planning ?? openAIAvailability)() : { providers: workspaceProviders };
  const invalidTransport = process.env.PRESENT_MODEL_TRANSPORT && !['codex', 'openai'].includes(process.env.PRESENT_MODEL_TRANSPORT);
  const providers = invalidTransport ? providersFor([], 'Unknown PRESENT_MODEL_TRANSPORT. Configure codex or openai explicitly.') : planning.providers;
  const supported = workspace.authenticated && workspaceProviders.some(provider => provider.id === 'sol' && provider.configured);
  return {
    defaultProvider: 'sol',
    providers: [...providers, { id: 'cerebras', name: agentNames.cerebras, model: agentModels.cerebras, configured: !!process.env.CEREBRAS_API_KEY, reasoning: ['none', 'low', 'medium', 'high'], fast: false, reason: process.env.CEREBRAS_API_KEY ? 'Key present; Cerebras account and generation remain unverified.' : 'Cerebras API key not configured.' }],
    planning: { transport: invalidTransport ? 'unsupported' : openai ? 'openai-responses' : 'codex-app-server', catalogVerified: !invalidTransport && providers.some(provider => provider.configured), generationVerified: false },
    workspace: { transport: 'codex-app-server', configured: workspace.configured, authenticated: workspace.authenticated, catalogVerified: workspace.models.length > 0, supported, status: supported ? 'catalog-verified' : 'unavailable', executionVerified: false, providers: workspaceProviders, reason: workspace.reason ?? (supported ? 'Account and default model catalog verified. Workspace profile and actual code execution remain unverified until a separately authorized work run.' : 'The default Sol workspace model is unavailable.') },
    voice: { configured: !!process.env.OPENAI_API_KEY, name: 'GPT-Live', model: 'gpt-live-1', verified: false },
  };
}
