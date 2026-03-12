import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk';
import {
  claimExecutorLease,
  completeTaskRun,
  createTaskRun,
  createArtifact,
  failTaskRun,
  getTaskRun,
  getWorkspaceSession,
  heartbeatExecutorLease,
  heartbeatExecutorSession,
  listExecutorSessions,
  listTaskRuns,
  recordKernelEvent,
  releaseExecutorLease,
  resolveKernelModelProfiles,
  setExecutorSessionState,
  startTaskRun,
  updateTaskRun,
} from '@present/kernel';
import type { ExecutorSession } from '@present/contracts';
import { loadCodexSdk } from './sdk';

type StartCodexTurnInput = {
  workspaceSessionId: string;
  prompt: string;
  summary: string;
  taskRunId?: string;
  executorSessionId?: string;
  threadId?: string | null;
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  networkAccessEnabled?: boolean;
};

const commandOutputCache = new Map<string, string>();

const resolveExecutor = (workspaceSessionId: string, executorSessionId?: string) => {
  const sessions = listExecutorSessions(workspaceSessionId);
  if (executorSessionId) {
    return sessions.find((session) => session.id === executorSessionId) ?? null;
  }
  return sessions[0] ?? null;
};

const resolveApiKey = (executor: ExecutorSession) => {
  if (executor.authMode === 'chatgpt') return undefined;
  const explicit = executor.metadata.apiKey;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const envName = typeof executor.metadata.apiKeyEnv === 'string' ? executor.metadata.apiKeyEnv : 'CODEX_API_KEY';
  return process.env[envName] ?? process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY;
};

const resolveModel = async (modelOverride?: string) => {
  if (modelOverride?.trim()) return modelOverride.trim();
  const profiles = await resolveKernelModelProfiles();
  return profiles.find((profile) => profile.role === 'executor')?.model ?? 'gpt-5.3-codex';
};

const createTextArtifactFromItem = (input: {
  item: ThreadItem;
  workspaceSessionId: string;
  traceId: string;
}) => {
  if (input.item.type === 'agent_message') {
    return createArtifact({
      workspaceSessionId: input.workspaceSessionId,
      traceId: input.traceId,
      kind: 'review_report',
      title: 'Codex response',
      mimeType: 'text/markdown',
      content: input.item.text,
      metadata: { itemId: input.item.id, source: 'codex_sdk' },
    });
  }

  if (input.item.type === 'command_execution' && input.item.aggregated_output.trim()) {
    return createArtifact({
      workspaceSessionId: input.workspaceSessionId,
      traceId: input.traceId,
      kind: 'command_output',
      title: input.item.command,
      mimeType: 'text/plain',
      content: input.item.aggregated_output,
      metadata: {
        itemId: input.item.id,
        status: input.item.status,
        exitCode: input.item.exit_code ?? null,
        source: 'codex_sdk',
      },
    });
  }

  if (input.item.type === 'file_change') {
    return createArtifact({
      workspaceSessionId: input.workspaceSessionId,
      traceId: input.traceId,
      kind: 'file_patch',
      title: 'Codex file change',
      mimeType: 'application/json',
      content: JSON.stringify(input.item.changes, null, 2),
      metadata: { itemId: input.item.id, status: input.item.status, source: 'codex_sdk' },
    });
  }

  return null;
};

const handleCodexItemEvent = (input: {
  eventType: ThreadEvent['type'];
  item: ThreadItem;
  workspaceSessionId: string;
  traceId: string;
}) => {
  const { item } = input;

  if (item.type === 'command_execution') {
    if (input.eventType === 'item.started') {
      recordKernelEvent({
        type: 'command.started',
        traceId: input.traceId,
        workspaceSessionId: input.workspaceSessionId,
        commandId: item.id,
        command: item.command,
        output: null,
        metadata: { source: 'codex_sdk' },
      });
      commandOutputCache.set(item.id, item.aggregated_output);
      return;
    }

    if (input.eventType === 'item.updated') {
      const previous = commandOutputCache.get(item.id) ?? '';
      if (item.aggregated_output !== previous) {
        commandOutputCache.set(item.id, item.aggregated_output);
        recordKernelEvent({
          type: 'command.output',
          traceId: input.traceId,
          workspaceSessionId: input.workspaceSessionId,
          commandId: item.id,
          command: item.command,
          output: item.aggregated_output,
          metadata: { source: 'codex_sdk' },
        });
      }
      return;
    }

    if (input.eventType === 'item.completed') {
      createTextArtifactFromItem(input);
      recordKernelEvent({
        type: item.status === 'failed' ? 'command.failed' : 'command.completed',
        traceId: input.traceId,
        workspaceSessionId: input.workspaceSessionId,
        commandId: item.id,
        command: item.command,
        output: item.aggregated_output,
        metadata: { exitCode: item.exit_code ?? null, source: 'codex_sdk' },
      });
    }
    return;
  }

  if (item.type === 'mcp_tool_call') {
    const eventType =
      input.eventType === 'item.started'
        ? 'tool.started'
        : item.status === 'failed'
          ? 'tool.failed'
          : 'tool.completed';

    recordKernelEvent({
      type: eventType,
      traceId: input.traceId,
      workspaceSessionId: input.workspaceSessionId,
      toolCallId: item.id,
      toolName: `${item.server}.${item.tool}`,
      detail:
        item.status === 'failed'
          ? item.error?.message ?? null
          : input.eventType === 'item.completed'
            ? JSON.stringify(item.result?.structured_content ?? item.result?.content ?? null)
            : null,
      metadata: { arguments: item.arguments, source: 'codex_sdk' },
    });
    return;
  }

  if (item.type === 'file_change' && input.eventType === 'item.completed') {
    const artifact = createTextArtifactFromItem(input);
    if (item.status === 'completed' && artifact) {
      recordKernelEvent({
        type: 'patch.applied',
        traceId: input.traceId,
        workspaceSessionId: input.workspaceSessionId,
        artifactId: artifact.id,
        summary: artifact.title,
        metadata: { changes: item.changes, source: 'codex_sdk' },
      });
    }
    return;
  }

  if (item.type === 'agent_message' && input.eventType === 'item.completed') {
    createTextArtifactFromItem(input);
  }
};

const executeCodexTurn = async (input: {
  taskRunId: string;
  workspaceSessionId: string;
  executor: ExecutorSession;
  prompt: string;
  threadId?: string | null;
  model?: string;
  sandboxMode?: StartCodexTurnInput['sandboxMode'];
  approvalPolicy?: StartCodexTurnInput['approvalPolicy'];
  networkAccessEnabled?: boolean;
}) => {
  const workspace = getWorkspaceSession(input.workspaceSessionId);
  const taskRun = await getTaskRun(input.taskRunId);
  if (!workspace || !taskRun) {
    throw new Error('Workspace or task run not found');
  }

  const lease = claimExecutorLease({
    workspaceSessionId: workspace.id,
    identity: input.executor.identity,
  });
  if (!lease.acquired) {
    throw new Error(`Executor lease is already held by ${lease.lease.identity}`);
  }

  setExecutorSessionState(input.executor.id, 'busy');
  startTaskRun(taskRun.id, {
    executorSessionId: input.executor.id,
    authMode: input.executor.authMode,
    codexThreadId: input.threadId ?? null,
  });

  const heartbeatInterval = setInterval(() => {
    void Promise.resolve().then(() => {
      heartbeatExecutorSession(input.executor.id);
      heartbeatExecutorLease({
        workspaceSessionId: workspace.id,
        identity: input.executor.identity,
      });
    });
  }, 10_000);

  try {
    const { Codex } = await loadCodexSdk();
    const model = await resolveModel(input.model);
    const codex = new Codex({
      baseUrl: input.executor.codexBaseUrl ?? undefined,
      apiKey: resolveApiKey(input.executor),
    });

    const threadOptions = {
      model,
      sandboxMode: input.sandboxMode ?? 'workspace-write',
      workingDirectory: workspace.workspacePath,
      approvalPolicy: input.approvalPolicy ?? 'on-request',
      networkAccessEnabled: input.networkAccessEnabled ?? true,
    };

    const thread = input.threadId ? codex.resumeThread(input.threadId, threadOptions) : codex.startThread(threadOptions);
    const streamedTurn = await thread.runStreamed(input.prompt);
    let finalResponse = '';
    let usage: Usage | null = null;

    for await (const event of streamedTurn.events) {
      if (event.type === 'thread.started') {
        updateTaskRun(taskRun.id, {
          metadata: {
            codexThreadId: event.thread_id,
            model,
            executorSessionId: input.executor.id,
          },
        });
        continue;
      }

      if (event.type === 'turn.started') {
        recordKernelEvent({
          type: 'turn.started',
          traceId: taskRun.traceId,
          workspaceSessionId: workspace.id,
          taskRunId: taskRun.id,
          title: taskRun.summary,
          detail: 'Codex turn started.',
          metadata: { model, executorSessionId: input.executor.id },
        });
        continue;
      }

      if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
        handleCodexItemEvent({
          eventType: event.type,
          item: event.item,
          workspaceSessionId: workspace.id,
          traceId: taskRun.traceId,
        });
        if (event.item.type === 'agent_message' && event.type === 'item.completed') {
          finalResponse = event.item.text;
        }
        continue;
      }

      if (event.type === 'turn.completed') {
        usage = event.usage;
        continue;
      }

      if (event.type === 'turn.failed') {
        throw new Error(event.error.message);
      }

      if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    completeTaskRun(taskRun.id, {
      finalResponse,
      usage,
      executorSessionId: input.executor.id,
      model,
      codexThreadId: thread.id,
    });
    setExecutorSessionState(input.executor.id, 'ready');
  } catch (error) {
    failTaskRun(
      taskRun.id,
      error instanceof Error ? error.message : 'Codex turn failed.',
      error instanceof Error ? { stack: error.stack ?? null } : {},
    );
    setExecutorSessionState(input.executor.id, 'offline');
    throw error;
  } finally {
    clearInterval(heartbeatInterval);
    heartbeatExecutorSession(input.executor.id);
    releaseExecutorLease(workspace.id, input.executor.identity);
  }
};

export async function startCodexTurn(input: StartCodexTurnInput) {
  const workspace = getWorkspaceSession(input.workspaceSessionId);
  if (!workspace) {
    throw new Error('Workspace session not found');
  }

  const executor = resolveExecutor(input.workspaceSessionId, input.executorSessionId);
  if (!executor) {
    throw new Error('No active executor session found');
  }

  const existingTask = input.taskRunId ? await getTaskRun(input.taskRunId) : null;
  const taskRun =
    existingTask ??
    listTaskRuns(input.workspaceSessionId).find(
      (task) =>
        task.status === 'queued' &&
        task.taskType === 'codex.turn' &&
        task.summary === input.summary &&
        task.metadata.prompt === input.prompt,
    ) ??
    null;

  const ensuredTask =
    taskRun ??
    createTaskRun({
      workspaceSessionId: input.workspaceSessionId,
      summary: input.summary,
      taskType: 'codex.turn',
      metadata: {
        prompt: input.prompt,
        requestedThreadId: input.threadId ?? null,
      },
    });

  void executeCodexTurn({
    taskRunId: ensuredTask.id,
    workspaceSessionId: input.workspaceSessionId,
    executor,
    prompt: input.prompt,
    threadId: input.threadId,
    model: input.model,
    sandboxMode: input.sandboxMode,
    approvalPolicy: input.approvalPolicy,
    networkAccessEnabled: input.networkAccessEnabled,
  }).catch(() => {
    // The failure is persisted into the task run and trace ledger.
  });

  return ensuredTask;
}
