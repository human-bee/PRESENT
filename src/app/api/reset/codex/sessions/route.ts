import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceSession } from '@present/kernel';
import { createCodexBrokerSession } from '@present/codex-broker/client';
import { flushResetKernelWrites, hydrateResetKernel } from '../../_lib/persistence';
import {
  persistConnectedRemoteWorkspace,
  resolveRemoteWorkingDirectory,
  upsertRemoteExecutor,
} from '../_lib/remote-session';

export const runtime = 'nodejs';

const createSessionSchema = z.object({
  workspaceSessionId: z.string().min(1),
  remoteWorkspacePath: z.string().optional(),
  reconnect: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await hydrateResetKernel();
    const payload = createSessionSchema.parse(await request.json());
    const workspace = getWorkspaceSession(payload.workspaceSessionId);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace session not found' }, { status: 404 });
    }

    const remoteWorkingDirectory = resolveRemoteWorkingDirectory(workspace, payload.remoteWorkspacePath);
    const { session } = await createCodexBrokerSession({
      workspaceSessionId: workspace.id,
      remoteWorkingDirectory,
      reconnect: payload.reconnect ?? true,
    });
    const executorSession = upsertRemoteExecutor(workspace.id, session);
    persistConnectedRemoteWorkspace(workspace.id, session, executorSession.id);
    await flushResetKernelWrites();

    return NextResponse.json(
      {
        sessionId: session.sessionId,
        status: session.status,
        frameUrl: session.frameUrl,
        proxyBaseUrl: session.proxyBaseUrl,
        executorSessionId: executorSession.id,
        remoteWorkingDirectory: session.remoteWorkingDirectory,
        lastHeartbeatAt: session.lastHeartbeatAt,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to create Codex remote session.',
      },
      { status: 400 },
    );
  }
}
