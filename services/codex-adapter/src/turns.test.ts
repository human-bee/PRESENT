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

const mockThreadOptions: Array<Record<string, unknown>> = [];
const mockCodexConfigs: Array<Record<string, unknown>> = [];

jest.mock('./sdk', () => ({
  loadCodexSdk: async () => ({
    Codex: class MockCodex {
      constructor(config: Record<string, unknown>) {
        mockCodexConfigs.push(config);
      }

      startThread(options: Record<string, unknown>) {
        mockThreadOptions.push(options);
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

      resumeThread(_threadId: string, options: Record<string, unknown>) {
        return this.startThread(options);
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
    mockThreadOptions.length = 0;
    mockCodexConfigs.length = 0;
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

  it('uses the remote working directory override and skips local api key injection for remote-managed executors', async () => {
    const workspace = openWorkspaceSession({
      workspacePath: process.cwd(),
      title: 'Remote Codex Turn Test',
      branch: 'codex/reset',
      metadata: {
        codexRemote: {
          remoteWorkspacePath: '/srv/codex/repos/PRESENT',
        },
      },
    });
    const executor = registerExecutorSession({
      workspaceSessionId: workspace.id,
      identity: 'remote-codex:test',
      kind: 'hosted_executor',
      authMode: 'shared_key',
      codexBaseUrl: 'http://127.0.0.1:4101/sessions/cxs_test/proxy',
      metadata: {
        remoteManagedAuth: true,
        remoteWorkingDirectory: '/srv/codex/repos/PRESENT',
      },
    });

    await startCodexTurn({
      workspaceSessionId: workspace.id,
      executorSessionId: executor.id,
      summary: 'Remote codex turn',
      prompt: 'List the repo root.',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockCodexConfigs.at(-1)?.['baseUrl']).toBe('http://127.0.0.1:4101/sessions/cxs_test/proxy');
    expect(mockCodexConfigs.at(-1)?.['apiKey']).toBeUndefined();
    expect(mockThreadOptions.at(-1)?.['workingDirectory']).toBe('/srv/codex/repos/PRESENT');
  });
});
