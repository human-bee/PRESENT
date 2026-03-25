import { render, screen, waitFor } from '@testing-library/react';
import McpAppWidget from './mcp-app-widget';
import { loadMcpAppResource } from '@/lib/mcp-apps/resource-loader';

jest.mock('@modelcontextprotocol/ext-apps/app-bridge', () => ({
  AppBridge: class {
    async connect() {}
    async teardownResource() {}
    async sendToolInput() {}
    async sendToolResult() {}
    setHostContext() {}
  },
  PostMessageTransport: class {
    async close() {}
  },
  buildAllowAttribute: () => '',
}));

jest.mock('@/lib/component-registry', () => ({
  useComponentRegistration: jest.fn(),
}));

jest.mock('@/lib/mcp-bridge', () => ({
  waitForMcpReady: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/mcp-apps/server-utils', () => ({
  resolveMcpServer: jest.fn().mockReturnValue({ server: undefined }),
  getMcpServerUrl: jest.fn().mockReturnValue('http://mcp.local'),
}));

jest.mock('@/lib/mcp-apps/resource-loader', () => ({
  loadMcpAppResource: jest.fn(),
  resolveToolResourceUri: jest.fn().mockReturnValue(null),
  callMcpMethod: jest.fn(),
}));

describe('McpAppWidget', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => 'mcp-widget-test',
      },
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockReturnValue({ matches: false }),
    });

    (loadMcpAppResource as jest.Mock).mockReset();
    (loadMcpAppResource as jest.Mock).mockResolvedValue({
      html: '<html><body>widget</body></html>',
    });
  });

  it('reloads the widget resource when parent props change', async () => {
    const { rerender } = render(
      <McpAppWidget
        title="Weather"
        resourceUri="ui://weather-one"
        autoRun={false}
      />,
    );

    await waitFor(() => {
      expect(loadMcpAppResource).toHaveBeenCalledWith({
        resourceUri: 'ui://weather-one',
        serverUrl: 'http://mcp.local',
      });
    });

    rerender(
      <McpAppWidget
        title="Weather Updated"
        resourceUri="ui://weather-two"
        autoRun={false}
      />,
    );

    await waitFor(() => {
      expect(loadMcpAppResource).toHaveBeenCalledWith({
        resourceUri: 'ui://weather-two',
        serverUrl: 'http://mcp.local',
      });
      expect(screen.getByTitle('Weather Updated')).toBeTruthy();
    });
  });
});
