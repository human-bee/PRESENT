import path from 'node:path';
import {
  getTaskRun,
  listArtifacts,
  listTraceEvents,
  openWorkspaceSession,
  registerExecutorSession,
  resetKernelStateForTests,
} from '@present/kernel';
import { startCodexTurn } from './turns';

jest.mock('./sdk', () => ({
  loadCodexSdk: async () => ({
    Codex: class MockCodex {
      startThread() {
        return {
          id: 'thread_mock_1',
          async runStreamed() {
            async function* events() {
              yield { type: 'thread.started', thread_id: 'thread_mock_1' };
              yield { type: 'turn.started' };
              yield {
                type: 'item.started',
                item: {
                  id: 'cmd_1',
                  type: 'command_execution',
                  command: 'npm test',
                  aggregated_output: '',
                  status: 'in_progress',
                },
              };
              yield {
                type: 'item.updated',
                item: {
                  id: 'cmd_1',
                  type: 'command_execution',
                  command: 'npm test',
                  aggregated_output: 'tests running',
                  status: 'in_progress',
                },
              };
              yield {
                type: 'item.completed',
                item: {
                  id: 'cmd_1',
                  type: 'command_execution',
                  command: 'npm test',
                  aggregated_output: 'tests passed',
                  status: 'completed',
                  exit_code: 0,
                },
              };
              yield {
                type: 'item.completed',
                item: {
                  id: 'msg_1',
                  type: 'agent_message',
                  text: 'Finished the requested turn.',
                },
              };
              yield {
                type: 'turn.completed',
                usage: {
                  input_tokens: 10,
                  cached_input_tokens: 0,
                  output_tokens: 20,
                },
              };
            }
            return { events: events() };
          },
        };
      }

      resumeThread() {
        return this.startThread();
      }
    },
  }),
}));

describe('Codex turns', () => {
  beforeEach(() => {
    process.env.PRESENT_RESET_STATE_PATH = path.join(
      process.cwd(),
      '.tmp',
      `present-reset-state-turns-${Date.now()}-${Math.random()}.json`,
    );
    resetKernelStateForTests();
  });

  afterEach(() => {
    resetKernelStateForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
  });

  it('starts a streamed Codex turn and persists artifacts and trace events', async () => {
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Codex Turn Test',
      branch: 'codex/reset',
    });
    const executor = registerExecutorSession({
      workspaceSessionId: workspace.id,
      identity: 'local-companion',
      kind: 'local_companion',
      authMode: 'chatgpt',
      capabilities: ['code_edit', 'code_review'],
    });

    const taskRun = await startCodexTurn({
      workspaceSessionId: workspace.id,
      executorSessionId: executor.id,
      summary: 'Codex turn',
      prompt: 'Run tests and summarize the result.',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const persistedTask = await getTaskRun(taskRun.id);
    const artifacts = listArtifacts(workspace.id);
    const traceEvents = listTraceEvents(taskRun.traceId);

    expect(persistedTask?.status).toBe('succeeded');
    expect(persistedTask?.result?.['finalResponse']).toBe('Finished the requested turn.');
    expect(artifacts.some((artifact) => artifact.kind === 'command_output')).toBe(true);
    expect(traceEvents.some((event) => event.type === 'command.output')).toBe(true);
    expect(traceEvents.some((event) => event.type === 'turn.completed')).toBe(true);
  });
});
