import { NextResponse } from 'next/server';
import { deleteCodexBrokerSession, getCodexBrokerSession } from '@present/codex-broker/client';
import { flushResetKernelWrites, hydrateResetKernel } from '../../../_lib/persistence';
import {
  findRemoteExecutorBySessionId,
  findRemoteWorkspaceSessionId,
  persistDisconnectedRemoteWorkspace,
} from '../../_lib/remote-session';

export const runtime = 'nodejs';

const BROKER_NOT_FOUND_ERROR = 'Codex broker session not found.';

const readErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return null;
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Fall back to the original message when the client already passed through a plain string.
  }
  return error.message.trim() || null;
};

const isBrokerNotFoundError = (error: unknown) => readErrorMessage(error) === BROKER_NOT_FOUND_ERROR;

const reconcileDisconnectedRemoteWorkspace = async (sessionId: string) => {
  const workspaceSessionId = findRemoteWorkspaceSessionId(sessionId);
  if (!workspaceSessionId) return false;
  const nextWorkspace = persistDisconnectedRemoteWorkspace(workspaceSessionId, sessionId);
  if (!nextWorkspace) return false;
  await flushResetKernelWrites();
  return true;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  await hydrateResetKernel();
  const { sessionId } = await params;
  try {
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
    if (isBrokerNotFoundError(error)) {
      await reconcileDisconnectedRemoteWorkspace(sessionId);
      return NextResponse.json({ error: 'Codex remote session not found.' }, { status: 404 });
    }
    return NextResponse.json(
      { error: readErrorMessage(error) ?? 'Failed to load Codex remote session.' },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  await hydrateResetKernel();
  const { sessionId } = await params;
  let brokerSessionMissing = false;

  try {
    await deleteCodexBrokerSession(sessionId);
  } catch (error) {
    if (isBrokerNotFoundError(error)) {
      brokerSessionMissing = true;
    } else {
      return NextResponse.json(
        { error: readErrorMessage(error) ?? 'Failed to delete Codex remote session.' },
        { status: 502 },
      );
    }
  }

  const reconciled = await reconcileDisconnectedRemoteWorkspace(sessionId);
  if (brokerSessionMissing && !reconciled) {
    return NextResponse.json({ error: 'Codex remote session not found.' }, { status: 404 });
  }

  return NextResponse.json({
    deleted: true,
    brokerSessionMissing,
  });
}
