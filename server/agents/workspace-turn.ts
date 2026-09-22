import { describeCommand } from './command-receipt';
import type { WorkExecutionState } from '../../shared/work-execution';
import { AgentError } from './contract';
import { record, type WireMessage } from './codex-wire';
import type { WorkspaceRunInput, WorkspaceWire } from './workspace-work';

const itemsOf = (turn: Record<string, unknown>): Record<string, unknown>[] => Array.isArray(turn.items) ? turn.items.map(record) : [];
const finalText = (turn: Record<string, unknown>) => itemsOf(turn).filter(item => item.type === 'agentMessage' && item.phase !== 'commentary' && typeof item.text === 'string').at(-1)?.text as string | undefined;

/** Correlate durable turn checkpoints before considering another dispatch. */
export async function runWorkspaceTurn(wire: WorkspaceWire, input: WorkspaceRunInput, cwd: string, signal: AbortSignal): Promise<string> {
  const state = structuredClone(input.state), threadId = state.threadId;
  if (!threadId) throw new AgentError('The local work task was not saved.');
  let turnId = ['dispatching', 'running'].includes(state.phase) ? state.turnId : null;
  let output = '', rejectCompletion: (error: Error) => void = () => {}, resolveCompletion: (value: string) => void = () => {};
  let polling: ReturnType<typeof setInterval> | undefined, reading = false;
  const early: WireMessage[] = [];
  const save = (patch: Partial<WorkExecutionState>) => { Object.assign(state, patch); input.onCheckpoint(structuredClone(state)); };
  const completion = new Promise<string>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  void completion.catch(() => {});
  const receipt = (item: Record<string, unknown>) => {
    if (item.type !== 'commandExecution' || typeof item.id !== 'string' || typeof item.command !== 'string' || !['completed', 'failed', 'declined'].includes(String(item.status))) return;
    const command = { id: item.id.slice(0, 100), ...describeCommand(item.command, cwd), status: item.status as 'completed' | 'failed' | 'declined', exitCode: typeof item.exitCode === 'number' && Number.isInteger(item.exitCode) ? item.exitCode : null };
    save({ commands: [...state.commands.filter(previous => previous.id !== command.id), command].slice(-12) });
  };
  const finish = (turn: Record<string, unknown>) => {
    for (const item of itemsOf(turn)) receipt(item);
    output = finalText(turn) ?? output;
    if (turn.status === 'completed') {
      if (output) resolveCompletion(output);
      else { save({ phase: 'failed' }); rejectCompletion(new AgentError('Codex completed without a work artifact.')); }
    } else if (turn.status === 'failed' || turn.status === 'interrupted') {
      save({ phase: turn.status }); rejectCompletion(new AgentError(`Local work ${turn.status}. Its files have been retained.`));
    }
  };
  const listener = (message: WireMessage) => {
    try {
      if (message.method === 'closed') { rejectCompletion(new AgentError('The local work connection stopped. Resume to reconcile its saved turn.')); return; }
      if (!['item/completed', 'turn/completed', 'error'].includes(message.method ?? '')) return;
      const params = record(message.params); if (params.threadId !== threadId) return;
      if (!turnId) { if (early.length < 256) early.push(message); return; }
      const turn = record(params.turn); if ((params.turnId ?? turn.id) !== turnId) return;
      if (message.method === 'item/completed') {
        const item = record(params.item); receipt(item);
        if (item.type === 'agentMessage' && item.phase !== 'commentary' && typeof item.text === 'string') output = item.text;
      }
      if (message.method === 'turn/completed') finish(turn);
      if (message.method === 'error' && params.willRetry === false) rejectCompletion(new AgentError('The local work provider failed. Resume to reconcile its saved turn.'));
    } catch (error) { rejectCompletion(error instanceof Error ? error : new AgentError('Local work could not be checkpointed.')); }
  };
  const readTurn = async () => {
    const response = await wire.request<{ thread: { turns?: unknown[] } }>('thread/read', { threadId, includeTurns: true });
    const turns = (response.thread.turns ?? []).map(record);
    const matches = turns.filter(turn => turnId ? turn.id === turnId : itemsOf(turn).some(item => item.type === 'userMessage' && item.clientId === state.dispatchId));
    if (matches.length !== 1 || typeof matches[0].id !== 'string') throw new AgentError('The checkpointed work turn could not be identified. A duplicate turn was not started.', 409);
    turnId = matches[0].id; save({ turnId, phase: 'running' }); return matches[0];
  };
  const abort = () => rejectCompletion(new AgentError('Local work was cancelled.', 408));
  wire.listeners.add(listener); signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new AgentError('Local work was cancelled.', 408);
    if (state.phase === 'dispatching' || state.phase === 'running') {
      finish(await readTurn());
      polling = setInterval(() => {
        if (reading || signal.aborted) return; reading = true;
        void readTurn().then(finish, rejectCompletion).finally(() => { reading = false; });
      }, 1000);
    } else {
      save({ phase: 'dispatching', turnId: null, dispatchId: `present-work:${input.jobId}:${input.attempt}`, commands: [] });
      try {
        const started = await wire.request<{ turn: { id: string } }>('turn/start', {
          threadId, clientUserMessageId: state.dispatchId, input: [{ type: 'text', text: input.prompt, text_elements: [] }], effort: input.reasoning ?? 'low', serviceTierForTurn: input.fast ? 'priority' : 'default',
          cwd, runtimeWorkspaceRoots: [cwd], environments: [{ environmentId: 'local', cwd, runtimeWorkspaceRoots: [cwd] }],
          permissions: 'present-work', approvalPolicy: 'never', outputSchema: input.outputSchema,
        });
        turnId = started.turn.id; save({ phase: 'running', turnId });
      } catch (error) {
        if (error instanceof AgentError && error.cause) save({ phase: 'failed' }); // A definite RPC rejection did not dispatch a turn.
        throw error;
      }
      for (const message of early) listener(message);
    }
    if (signal.aborted) abort();
    return await completion;
  } finally {
    if (polling) clearInterval(polling);
    signal.removeEventListener('abort', abort);
    if (signal.aborted && turnId && !wire.closed) {
      try {
        await wire.request('turn/interrupt', { threadId, turnId }, 5000);
        const recovered = await readTurn();
        if (recovered.status === 'failed' || recovered.status === 'interrupted') save({ phase: recovered.status });
      } catch { /* Keep the unresolved checkpoint; a later resume must reconcile it. */ }
    }
    wire.listeners.delete(listener);
  }
}
