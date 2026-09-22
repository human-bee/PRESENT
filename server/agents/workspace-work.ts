import type { GenerationOptions } from '../../shared/agent-models';
import { join } from 'node:path';
import { workArtifactSchema, workInstructions, workOutputSchema } from '../../shared/work';
import { workExecutionStateSchema, type WorkExecution, type WorkExecutionState } from '../../shared/work-execution';
import { codexCommand, codexConfigured } from './codex';
import { CodexWire } from './codex-wire';
import { AgentError, agentModels } from './contract';
import { prepareWorkspace, readWorkspaceFiles } from './workspace-sandbox';
import { runWorkspaceTurn } from './workspace-turn';

export type WorkspaceWire = Pick<CodexWire, 'request' | 'send' | 'listeners' | 'close' | 'closed'> & { stopped?: Promise<void> };
export type WorkspaceRunInput = GenerationOptions & {
  prompt: string; provider: 'spark' | 'codex' | 'luna' | 'terra'; jobId: string; attempt: number; state: WorkExecutionState;
  onCheckpoint: (state: WorkExecutionState) => void; outputSchema?: object;
};
export type WorkspaceRunResult = { output: string; execution: WorkExecution };
export type WorkspaceRunner = (input: WorkspaceRunInput, signal: AbortSignal) => Promise<WorkspaceRunResult>;
type Options = { directory?: string; wire?: (options: { cwd: string; config: Record<string, unknown> }) => WorkspaceWire; configured?: () => boolean };
type ThreadResult = { thread: { id: string }; model: string; cwd: string; runtimeWorkspaceRoots: string[]; activePermissionProfile: { id: string } | null };

export function workspaceThreadOptions(cwd: string, provider: 'spark' | 'codex' | 'luna' | 'terra') {
  return {
    model: agentModels[provider], cwd, runtimeWorkspaceRoots: [cwd], permissions: 'present-work', approvalPolicy: 'never',
    developerInstructions: workInstructions,
  };
}

/** Durable Codex work runs only in a server-created per-card directory. Widgets keep their no-tool profile. */
export function createRunWorkspaceWork(options: Options = {}): WorkspaceRunner {
  const active = new Set<string>();
  return async (input, signal) => {
    let state = workExecutionStateSchema.parse(input.state), output = '';
    if (active.has(state.workspaceId)) throw new AgentError('This work card already has a running workspace.', 409);
    if (signal.aborted) throw new AgentError('Local work was cancelled.', 408);
    const base = options.directory ?? join(process.cwd(), '.data', 'workspaces');
    const workspace = prepareWorkspace(base, state.workspaceId), continued = state.threadId !== null;
    const checkpoint = (next: WorkExecutionState) => { state = workExecutionStateSchema.parse(next); input.onCheckpoint(structuredClone(state)); };
    let wire: WorkspaceWire | undefined;
    active.add(state.workspaceId);
    try {
      if (state.phase === 'completed' && state.output) output = state.output;
      else {
        if (!(options.configured ?? codexConfigured)()) throw new AgentError('Sign in to local Codex with ChatGPT to execute workspace work.', 503);
        const command = codexCommand();
        if (!options.wire && !command) throw new AgentError('The local Codex command is unavailable.', 503);
        wire = options.wire ? options.wire(workspace) : new CodexWire(command as string, workspace);
        await wire.request('initialize', { clientInfo: { name: 'present_workspace', version: '0.1.0' }, capabilities: { experimentalApi: true } });
        wire.send({ method: 'initialized' });
        const account = await wire.request<{ account: { type: string } | null }>('account/read', { refreshToken: false });
        if (account.account?.type !== 'chatgpt') throw new AgentError('Workspace work requires the ChatGPT Codex subscription.', 503);
        const model = agentModels[input.provider], common = { ...workspaceThreadOptions(workspace.cwd, input.provider), serviceTier: input.fast ? 'priority' : 'default' };
        const response = state.threadId
          ? await wire.request<ThreadResult>('thread/resume', { ...common, threadId: state.threadId, excludeTurns: true })
          : await wire.request<ThreadResult>('thread/start', { ...common, allowProviderModelFallback: false, ephemeral: false, historyMode: 'legacy', environments: [{ environmentId: 'local', cwd: workspace.cwd, runtimeWorkspaceRoots: [workspace.cwd] }], dynamicTools: [], selectedCapabilityRoots: [] });
        if (response.model !== model || response.cwd !== workspace.cwd || response.runtimeWorkspaceRoots?.length !== 1 || response.runtimeWorkspaceRoots[0] !== workspace.cwd || response.activePermissionProfile?.id !== 'present-work') throw new AgentError('Codex did not confirm the isolated workspace profile. No work turn was started.', 503);
        if (state.threadId && response.thread.id !== state.threadId) throw new AgentError('Codex resumed a different task. No work turn was started.', 503);
        checkpoint({ ...state, threadId: response.thread.id });
        output = await runWorkspaceTurn(wire, { ...input, state, onCheckpoint: checkpoint, outputSchema: workOutputSchema }, workspace.cwd, signal);
        if (Buffer.byteLength(output) > 24000) { checkpoint({ ...state, phase: 'failed' }); throw new AgentError('The work artifact exceeded its output limit.'); }
        try { workArtifactSchema.parse(JSON.parse(output)); }
        catch { checkpoint({ ...state, phase: 'failed' }); throw new AgentError('Codex did not return a valid work artifact. Its source files are retained.'); }
        checkpoint({ ...state, phase: 'completed', output });
      }
    } finally {
      wire?.close(); await wire?.stopped; active.delete(state.workspaceId);
    }
    if (signal.aborted) throw new AgentError('Local work was cancelled.', 408);
    return { output, execution: { boundary: 'local-workspace', continued, commands: state.commands, files: readWorkspaceFiles(workspace.cwd) } };
  };
}
