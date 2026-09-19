import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { shouldDeferToolCallWhenNotExecutor, shouldExecuteIncomingToolCall } from './tool-call-execution-guard';
import { useToolRunner } from './useToolRunner';
import type { ToolCall, ToolRunResult } from '../utils/toolTypes';
import { ComponentRegistry } from '@/lib/component-registry';

const queueApiMock = {
  state: { jobs: [] },
  enqueue: jest.fn(),
  markStarted: jest.fn(),
  markComplete: jest.fn(),
  markError: jest.fn(),
  reset: jest.fn(),
};

const registryApiMock = {
  getHandler: jest.fn(),
  listTools: jest.fn(() => []),
};

jest.mock('./useToolQueue', () => ({
  useToolQueue: () => queueApiMock,
}));

jest.mock('./useToolRegistry', () => ({
  useToolRegistry: () => registryApiMock,
}));

jest.mock('@/hooks/use-room-executor', () => ({
  useRoomExecutor: () => ({
    sessionId: null,
    isExecutor: true,
    executorIdentity: null,
    leaseExpiresAt: null,
    status: 'idle',
    error: null,
  }),
}));

jest.mock('@/lib/journey-logger', () => ({
  logJourneyEvent: jest.fn(),
}));

jest.mock('@/lib/logging', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

type RunnerProbeProps = {
  onReady: (api: ReturnType<typeof useToolRunner>) => void;
  events?: Partial<{
    emitRequest: jest.Mock;
    emitDone: jest.Mock;
    emitError: jest.Mock;
    emitEditorAction: jest.Mock;
    log: jest.Mock;
    bus: { on: jest.Mock; send: jest.Mock };
  }>;
};

function RunnerProbe({ onReady, events }: RunnerProbeProps) {
  const api = useToolRunner({
    stewardEnabled: false,
    events: {
      emitRequest: jest.fn(),
      emitDone: jest.fn(),
      emitError: jest.fn(),
      emitEditorAction: jest.fn(),
      log: jest.fn(),
      bus: {
        on: jest.fn(() => () => {}),
        send: jest.fn(),
      },
      ...events,
    } as any,
  });

  React.useEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

describe('shouldExecuteIncomingToolCall', () => {
  it('skips execution for non-executor clients', () => {
    const processed = new Map<string, number>();
    const result = shouldExecuteIncomingToolCall({
      isExecutor: false,
      processed,
      roomKey: 'canvas-room',
      callId: 'c1',
      now: 1000,
    });
    expect(result.execute).toBe(false);
    expect(result.reason).toBe('not_executor');
    expect(processed.size).toBe(0);
  });

  it('dedupes already-processed call ids within ttl', () => {
    const processed = new Map<string, number>([['canvas-room:c1', 1000]]);
    const result = shouldExecuteIncomingToolCall({
      isExecutor: true,
      processed,
      roomKey: 'canvas-room',
      callId: 'c1',
      now: 1500,
      ttlMs: 120000,
    });
    expect(result.execute).toBe(false);
    expect(result.reason).toBe('deduped');
  });

  it('allows execution after dedupe ttl expiry', () => {
    const processed = new Map<string, number>([['canvas-room:c1', 1000]]);
    const result = shouldExecuteIncomingToolCall({
      isExecutor: true,
      processed,
      roomKey: 'canvas-room',
      callId: 'c1',
      now: 130001,
      ttlMs: 120000,
    });
    expect(result.execute).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(processed.has('canvas-room:c1')).toBe(true);
  });
});

describe('useToolRunner', () => {
  beforeEach(() => {
    cleanup();
    jest.clearAllMocks();
    registryApiMock.getHandler.mockReturnValue(undefined);
    ComponentRegistry.clear();
    (window as any).__custom_mcp_tools = {};
    (window as any).callMcpTool = jest.fn();
  });

  afterEach(() => {
    cleanup();
    ComponentRegistry.clear();
    delete (window as any).__custom_mcp_tools;
    delete (window as any).callMcpTool;
  });

  it('surfaces exa MCP unavailability as an error without fake scorecard updates', async () => {
    const emitRequest = jest.fn();
    const emitDone = jest.fn();
    const emitError = jest.fn();
    const callMcpTool = jest.fn().mockResolvedValue(undefined);
    (window as any).callMcpTool = callMcpTool;

    let runnerApi: ReturnType<typeof useToolRunner> | null = null;
    const onReady = jest.fn((api: ReturnType<typeof useToolRunner>) => {
      runnerApi = api;
    });

    const updateSpy = jest.spyOn(ComponentRegistry, 'update');

    render(
      <RunnerProbe
        onReady={onReady}
        events={{
          emitRequest,
          emitDone,
          emitError,
        }}
      />,
    );

    await waitFor(() => {
      expect(runnerApi).not.toBeNull();
    });

    const call: ToolCall = {
      id: 'call-exa-1',
      type: 'tool_call',
      payload: {
        tool: 'mcp_exa',
        params: {
          query: 'ai agents',
        },
      },
    };

    let result: ToolRunResult | undefined;
    await act(async () => {
      result = await runnerApi!.executeToolCall(call);
    });

    expect(callMcpTool).toHaveBeenCalledWith('exa', { query: 'ai agents' });
    expect(result).toEqual({
      status: 'ERROR',
      message:
        'Exa MCP is unavailable for "ai agents". Configure MCP servers in /mcp-config to enable real research results.',
      error: 'Exa MCP unavailable',
      results: [],
    });
    expect(queueApiMock.markError).toHaveBeenCalledWith(
      'call-exa-1',
      'Exa MCP is unavailable for "ai agents". Configure MCP servers in /mcp-config to enable real research results.',
    );
    expect(emitError).toHaveBeenCalledWith(
      call,
      expect.objectContaining({
        status: 'ERROR',
        message:
          'Exa MCP is unavailable for "ai agents". Configure MCP servers in /mcp-config to enable real research results.',
      }),
    );
    expect(emitDone).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('shouldDeferToolCallWhenNotExecutor', () => {
  it('defers when no executor identity is known yet', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'not_executor',
        executorIdentity: null,
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(true);
  });

  it('defers when executor identity already matches local identity', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'not_executor',
        executorIdentity: 'Canvas-User-1',
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(true);
  });

  it('does not defer when another executor is known', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'not_executor',
        executorIdentity: 'Canvas-User-2',
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(false);
  });

  it('does not defer deduped calls', () => {
    expect(
      shouldDeferToolCallWhenNotExecutor({
        reason: 'deduped',
        executorIdentity: null,
        localIdentity: 'Canvas-User-1',
      }),
    ).toBe(false);
  });
});
