import { NextResponse } from 'next/server';
import { deleteCodexBrokerSession, getCodexBrokerSession } from '@present/codex-broker/client';
import { flushResetKernelWrites, hydrateResetKernel } from '../../../_lib/persistence';
import {
  findRemoteExecutorBySessionId,
  persistDisconnectedRemoteWorkspace,
} from '../../_lib/remote-session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    await hydrateResetKernel();
    const { sessionId } = await params;
    const { session } = await getCodexBrokerSession(sessionId);
    const executorSession = findRemoteExecutorBySessionId(sessionId);
    return NextResponse.json({
      sessionId: session.sessionId,
      status: session.status,
      frameUrl: session.frameUrl,
      proxyBaseUrl: session.proxyBaseUrl,
      executorSessionId: executorSession?.id ?? null,
      remoteWorkingDirectory: session.remoteWorkingDirectory,
      lastHeartbeatAt: session.lastHeartbeatAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Codex remote session not found.' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  await hydrateResetKernel();
  const { sessionId } = await params;
  const executorSession = findRemoteExecutorBySessionId(sessionId);
  const deleted = await deleteCodexBrokerSession(sessionId).then((result) => result.deleted).catch(() => false);
  if (executorSession) {
    persistDisconnectedRemoteWorkspace(executorSession.workspaceSessionId, sessionId);
    await flushResetKernelWrites();
  }
  if (!deleted && !executorSession) {
    return NextResponse.json({ error: 'Codex remote session not found.' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
