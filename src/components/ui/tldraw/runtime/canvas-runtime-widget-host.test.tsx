import { render, screen, waitFor } from '@testing-library/react';
import type { WidgetInstance } from '@present/contracts';
import { CanvasRuntimeWidgetHost } from './canvas-runtime-widget-host';

jest.mock('@/components/ui/mcp/mcp-app-widget', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="mcp-app-widget">{String(props['toolName'] ?? 'mcp-app')}</div>
  ),
}));

jest.mock('@/components/ui/research/research-panel', () => {
  const actual = jest.requireActual('@/components/ui/research/research-panel');
  return {
    ...actual,
    ResearchPanel: (props: Record<string, unknown>) => (
      <div data-testid="research-panel">{String(props['title'] ?? 'Research Panel')}</div>
    ),
  };
});

jest.mock('@/components/ui/productivity/meeting-summary-widget', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="meeting-summary-widget">{String(props['title'] ?? 'Meeting Summary')}</div>
  ),
}));

jest.mock('@/components/ui/productivity/memory-recall-widget', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="memory-recall-widget">{String(props['title'] ?? 'Memory Recall')}</div>
  ),
}));

const baseNode = (overrides: Partial<WidgetInstance> = {}): WidgetInstance => ({
  id: 'widget:artifact_widget',
  kind: 'widget-frame',
  syncVersion: 'widget-sync-1',
  retention: 'persistent',
  layoutHint: {
    zone: 'center_stack',
    priority: 0,
    defaultSize: { w: 440, h: 336 },
  },
  title: 'Board Widget',
  artifactId: 'artifact_widget',
  artifactUri: '/api/reset/artifacts/artifact_widget?workspaceSessionId=ws_123',
  resourceUri: null,
  widgetRuntime: {
    hostKind: 'html_bundle',
    componentType: null,
    componentProps: {},
    resourceUri: null,
    serverName: null,
    toolName: null,
    args: null,
    displayMode: 'inline',
    contextKey: 'canvas',
  },
  bridgeState: {
    status: 'ready',
    resourceUri: null,
    lastHydratedAt: '2026-03-25T12:00:00.000Z',
    privatePayloadHash: null,
    metadata: {},
  },
  metadata: {
    kind: 'widget_bundle',
  },
  ...overrides,
});

describe('CanvasRuntimeWidgetHost', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders MCP app widgets through the real host path', () => {
    render(
      <CanvasRuntimeWidgetHost
        node={baseNode({
          widgetRuntime: {
            hostKind: 'mcp_app',
            componentType: null,
            componentProps: {
              autoRun: true,
            },
            resourceUri: 'ui://present/app.html',
            serverName: 'present-mcp',
            toolName: 'weather_lookup',
            args: { city: 'SF' },
            displayMode: 'inline',
            contextKey: 'canvas',
          },
        })}
      />,
    );

    expect(screen.getByTestId('mcp-app-widget').textContent).toContain('weather_lookup');
  });

  it('renders allowlisted component widgets through the runtime component host', () => {
    render(
      <CanvasRuntimeWidgetHost
        node={baseNode({
          title: 'Research Widget',
          widgetRuntime: {
            hostKind: 'component',
            componentType: 'ResearchPanel',
            componentProps: {
              title: 'Research Widget',
              results: [],
            },
            resourceUri: null,
            serverName: null,
            toolName: null,
            args: null,
            displayMode: 'inline',
            contextKey: 'canvas',
          },
        })}
      />,
    );

    expect(screen.getByTestId('research-panel').textContent).toContain('Research Widget');
  });

  it('shows deterministic error UI for unsupported component widgets', () => {
    render(
      <CanvasRuntimeWidgetHost
        node={baseNode({
          widgetRuntime: {
            hostKind: 'component',
            componentType: 'UnsupportedWidget',
            componentProps: {},
            resourceUri: null,
            serverName: null,
            toolName: null,
            args: null,
            displayMode: 'inline',
            contextKey: 'canvas',
          },
        })}
      />,
    );

    expect(screen.getByText(/only support ResearchPanel, MeetingSummaryWidget, MemoryRecallWidget/i)).toBeTruthy();
  });

  it('loads legacy html bundles from the artifact route instead of the canvas session payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artifact: {
          id: 'artifact_widget',
          workspaceSessionId: 'ws_123',
          traceId: null,
          kind: 'widget_bundle',
          title: 'Board Widget',
          mimeType: 'text/html',
          content: '<html><body>legacy</body></html>',
          createdAt: '2026-03-25T12:00:00.000Z',
          updatedAt: '2026-03-25T12:00:00.000Z',
          metadata: {},
        },
      }),
      text: async () => '',
    }) as unknown as typeof fetch;

    render(<CanvasRuntimeWidgetHost node={baseNode()} />);

    await waitFor(() => {
      expect(screen.getByTitle('Board Widget')).toBeTruthy();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/reset/artifacts/artifact_widget?workspaceSessionId=ws_123');
  });

  it('does not refetch html bundles when snapshot churn preserves the same artifact route', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artifact: {
          id: 'artifact_widget',
          workspaceSessionId: 'ws_123',
          traceId: null,
          kind: 'widget_bundle',
          title: 'Board Widget',
          mimeType: 'text/html',
          content: '<html><body>legacy</body></html>',
          createdAt: '2026-03-25T12:00:00.000Z',
          updatedAt: '2026-03-25T12:00:00.000Z',
          metadata: {},
        },
      }),
      text: async () => '',
    }) as unknown as typeof fetch;

    const { rerender } = render(<CanvasRuntimeWidgetHost node={baseNode()} />);
    await waitFor(() => {
      expect(screen.getByTitle('Board Widget')).toBeTruthy();
    });

    rerender(
      <CanvasRuntimeWidgetHost
        node={baseNode({
          syncVersion: 'widget-sync-1',
          bridgeState: {
            status: 'hydrating',
            resourceUri: null,
            lastHydratedAt: '2026-03-25T12:01:00.000Z',
            privatePayloadHash: null,
            metadata: {},
          },
        })}
      />,
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches html bundles when the artifact sync version changes on the same route', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifact: {
            id: 'artifact_widget',
            workspaceSessionId: 'ws_123',
            traceId: null,
            kind: 'widget_bundle',
            title: 'Board Widget',
            mimeType: 'text/html',
            content: '<html><body>legacy</body></html>',
            createdAt: '2026-03-25T12:00:00.000Z',
            updatedAt: '2026-03-25T12:00:00.000Z',
            metadata: {},
          },
        }),
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifact: {
            id: 'artifact_widget',
            workspaceSessionId: 'ws_123',
            traceId: null,
            kind: 'widget_bundle',
            title: 'Board Widget',
            mimeType: 'text/html',
            content: '<html><body>updated</body></html>',
            createdAt: '2026-03-25T12:00:00.000Z',
            updatedAt: '2026-03-25T12:01:00.000Z',
            metadata: {},
          },
        }),
        text: async () => '',
      } as unknown as Response);

    const { rerender } = render(<CanvasRuntimeWidgetHost node={baseNode()} />);
    await waitFor(() => {
      expect(screen.getByTitle('Board Widget')).toBeTruthy();
    });

    rerender(
      <CanvasRuntimeWidgetHost
        node={baseNode({
          syncVersion: 'widget-sync-2',
          bridgeState: {
            status: 'ready',
            resourceUri: null,
            lastHydratedAt: '2026-03-25T12:01:00.000Z',
            privatePayloadHash: null,
            metadata: {},
          },
        })}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
