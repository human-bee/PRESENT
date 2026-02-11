/**
 * McpConfigPage
 *
 * Configure MCP (Model Context Protocol) servers for the canvas workspace.
 *
 * Storage: Configs stored in localStorage as "mcp-servers" JSON, loaded by loadMcpServers()
 * Integration: Canvas loads configs for AI agent integrations via EnhancedMcpProvider
 *
 * Config Format:
 * - Simple: ["http://localhost:3001/mcp"]
 * - Advanced: [{ url: "http://localhost:3001/mcp", transport: "http", name: "Local Server" }]
 */

'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { McpStatusIndicator } from '@/components/ui/mcp/mcp-status-indicator';
import { useValidatedcustom } from '@/hooks/use-validated-custom';
import { computeMcpMappings, listRegistryTools, listWindowMcpTools } from '@/lib/mcp-introspection';

// Define MCP transport types
enum MCPTransport {
  SSE = 'sse',
  HTTP = 'http',
}

// Define MCP server configuration types
type MCPServerConfig =
  | string
  | {
    url: string;
    transport?: MCPTransport;
    name?: string;
  };

const McpConfigPage = () => {
  // Initialize from localStorage directly to avoid conflicts
  const initialMcpServers =
    typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('mcp-servers') || '[]') : [];

  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>(initialMcpServers);
  const [serverUrl, setServerUrl] = useState('');
  const [serverName, setServerName] = useState('');
  const [transportType, setTransportType] = useState<MCPTransport>(MCPTransport.HTTP);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const { toolRegistry } = useValidatedcustom();
  const [verifyOpen, setVerifyOpen] = useState(false);

  const regToolNames = useMemo(() => listRegistryTools(toolRegistry), [toolRegistry]);
  const winToolNames = useMemo(() => listWindowMcpTools(), []);
  const mappings = useMemo(() => computeMcpMappings(toolRegistry), [toolRegistry]);

  // Load saved servers from localStorage on mount
  // This useEffect can be removed since we initialize from localStorage directly

  // Save servers to localStorage when updated
  useEffect(() => {
    console.log('Saving to localStorage:', mcpServers);
    localStorage.setItem('mcp-servers', JSON.stringify(mcpServers));
    if (mcpServers.length > 0) {
      setSavedSuccess(true);
      const timer = setTimeout(() => setSavedSuccess(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [mcpServers]);

  const addServer = (e: React.FormEvent) => {
    e.preventDefault();
    if (serverUrl.trim()) {
      console.log('Adding server:', serverUrl.trim());

      const serverConfig = {
        url: serverUrl.trim(),
        transport: transportType,
        ...(serverName.trim() ? { name: serverName.trim() } : {}),
      };
      setMcpServers((prev) => [...prev, serverConfig]);

      // Reset form fields
      setServerUrl('');
      setServerName('');
      setTransportType(MCPTransport.HTTP);

      // Double-check localStorage immediately after update
      setTimeout(() => {
        const saved = localStorage.getItem('mcp-servers');
        console.log('Immediate localStorage check:', saved);
      }, 100);
    }
  };

  const removeServer = (index: number) => {
    console.log('Removing server at index:', index);
    setMcpServers((prev) => prev.filter((_, i) => i !== index));
  };

  // Helper function to get server display information
  const getServerInfo = (server: MCPServerConfig) => {
    if (typeof server === 'string') {
      return { url: server, transport: 'SSE (default)', name: null };
    } else {
      return {
        url: server.url,
        transport: server.transport || 'SSE (default)',
        name: server.name || null,
      };
    }
  };

  return (
    <div className="min-h-screen bg-surface p-8">
      <div className="max-w-2xl mx-auto bg-surface-elevated border border-default rounded-2xl shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="heading-lg">MCP server configuration</h1>
          <Link
            href="/canvas"
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
          >
            Back to Canvas
          </Link>
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Model Context Protocol Servers</h2>
          <p className="text-secondary mb-4 text-sm">
            Configure external MCP-compliant servers to extend the capabilities of your custom
            application. The servers listed here will be available as tool providers in your chat.
          </p>
          {winToolNames.length === 0 && (
            <div className="mb-4 p-3 rounded-lg bg-caution-surface text-caution border border-caution-outline text-sm">
              No MCP tools are currently registered in the window bridge. Add a server below, then
              use "Verify & Map" to confirm tools are available and mapped.
            </div>
          )}

          {/* MCP Status Indicator */}
          <div className="mb-6">
            <McpStatusIndicator showDetails={true} />
          </div>

          <form onSubmit={addServer} className="mb-6">
            <div className="flex flex-col space-y-2">
              <label htmlFor="server-url" className="font-medium text-secondary text-sm">
                Server URL
              </label>
              <input
                id="server-url"
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://your-mcp-server-url.com"
                className="px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                required
              />
            </div>

            <div className="flex flex-col space-y-2 mt-3">
              <label htmlFor="server-name" className="font-medium text-secondary text-sm">
                Server Name (optional)
              </label>
              <input
                id="server-name"
                type="text"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Custom server name"
                className="px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              />
            </div>

            <div className="flex flex-col space-y-2 mt-3">
              <label htmlFor="transport-type" className="font-medium text-secondary text-sm">
                Transport Type
              </label>
              <select
                id="transport-type"
                value={transportType}
                onChange={(e) => setTransportType(e.target.value as MCPTransport)}
                className="px-3 py-2 border border-default rounded-lg bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              >
                <option value={MCPTransport.SSE}>SSE</option>
                <option value={MCPTransport.HTTP}>HTTP (default)</option>
              </select>
            </div>

            <button
              type="submit"
              className="mt-4 px-4 py-2 rounded-lg w-full bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            >
              Add Server
            </button>
          </form>

          {savedSuccess && (
            <div className="mb-4 p-2 bg-success-surface text-success rounded-lg text-sm border border-success-surface">
              ✓ Servers saved to browser storage
            </div>
          )}

          {mcpServers.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Connected Servers:</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setVerifyOpen((v) => !v)}
                    className="px-2 py-1 text-xs rounded-lg bg-surface-secondary hover:bg-surface-tertiary border border-default"
                  >
                    {verifyOpen ? 'Hide Verification' : 'Verify & Map'}
                  </button>
                  <McpStatusIndicator showDetails={false} className="text-sm" />
                </div>
              </div>
              <ul className="border rounded-md divide-y">
                {mcpServers.map((server, index) => {
                  const serverInfo = getServerInfo(server);
                  const rowKey = serverInfo.url || serverInfo.name || String(index);
                  return (
                    <li key={rowKey} className="flex items-center justify-between p-3">
                      <div className="flex-1">
                        <div className="flex items-center">
                          <span className="text-success mr-2">●</span>
                          <span>{serverInfo.url}</span>
                        </div>
                        {(serverInfo.name || typeof server !== 'string') && (
                          <div className="text-sm text-secondary ml-5 mt-1">
                            {serverInfo.name && <div>Name: {serverInfo.name}</div>}
                            <div>Transport: {serverInfo.transport}</div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeServer(index)}
                        className="px-2 py-1 rounded-lg bg-danger-soft text-danger hover:bg-danger-soft-hover border border-danger-surface ml-2"
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              {verifyOpen && (
                <div className="mt-4 border border-default rounded-lg p-3 bg-surface-secondary">
                  <h4 className="font-medium mb-2">Verification</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-secondary mb-1">Window MCP Tools</div>
                      <ul className="list-disc ml-5">
                        {winToolNames.length === 0 && <li className="text-tertiary">none</li>}
                        {winToolNames.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-secondary mb-1">Registry Tools</div>
                      <ul className="list-disc ml-5">
                        {regToolNames.length === 0 && <li className="text-tertiary">none</li>}
                        {regToolNames.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-secondary mb-1">System Mappings</div>
                      <ul className="list-disc ml-5">
                        {mappings.length === 0 && <li className="text-tertiary">none</li>}
                        {mappings.map((m) => (
                          <li key={m.agentTool}>
                            <span className="font-mono">{m.agentTool}</span>
                            <span className="text-tertiary"> → </span>
                            <span className="font-mono">{m.mcpTool}</span>
                            <span
                              className={`ml-2 text-xs ${m.inRegistry ? 'text-success' : 'text-danger'}`}
                            >
                              {m.inRegistry ? 'in registry' : 'missing'}
                            </span>
                            <span
                              className={`ml-2 text-xs ${m.inWindow ? 'text-success' : 'text-danger'}`}
                            >
                              {m.inWindow ? 'in window' : 'not registered'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-tertiary">
                    If a mapping is missing, ensure your MCP server exposes tool names that match
                    the registry or add aliases in the System Registry.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center p-4 border border-dashed border-default rounded-lg text-secondary text-sm">
              No MCP servers configured yet
            </div>
          )}
        </div>

        <div className="bg-surface-secondary p-4 rounded-lg border border-default">
          <h3 className="font-semibold mb-2">What is MCP?</h3>
          <p className="text-secondary text-sm">
            The Model Context Protocol (MCP) is a standard that allows applications to communicate
            with external tools and services. By configuring MCP servers, you can extend your custom
            application with additional capabilities provided by these servers.
          </p>
        </div>
      </div>
    </div>
  );
};

export default McpConfigPage;
