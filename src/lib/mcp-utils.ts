/**
 * Type for MCP Server entries
 */
export type McpServer = string | {
  url: string;
  transport?: "sse" | "http";
  name?: string;
};

/**
 * Load and process MCP server configurations from localStorage
 */
export function loadMcpServers(): McpServer[] {
  if (typeof window === "undefined") return [];

  const savedServersData = localStorage.getItem("mcp-servers");
  if (!savedServersData) return [];

  try {
    const servers = JSON.parse(savedServersData);
    // Deduplicate servers by URL to prevent multiple tool registrations
    const uniqueUrls = new Set();
    const deduplicatedServers = servers.filter((server: McpServer) => {
      const url = typeof server === "string" ? server : server.url;
      if (uniqueUrls.has(url)) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[MCP] Duplicate server URL found, skipping: ${url}`);
        }
        return false;
      }
      uniqueUrls.add(url);
      return true;
    });
    
    // Log loading info in development
    if (process.env.NODE_ENV === 'development' && deduplicatedServers.length > 0) {
      console.log(`[MCP] Loading ${deduplicatedServers.length} MCP server(s)`);
    }
    
    return deduplicatedServers;
  } catch (e) {
    console.error("Failed to parse saved MCP servers", e);
    return [];
  }
}

/**
 * Suppress console warnings in development mode for cleaner logs
 */
export function suppressDevelopmentWarnings() {
  if (process.env.NODE_ENV === 'development') {
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;
    
    console.warn = (...args) => {
      // Suppress known tool overwrite warnings from Tambo MCP provider
      const message = args.join(' ');
      if (message.includes('Overwriting tool') || 
          message.includes('TamboRegistryProvider') ||
          message.includes('Added non-passive event listener') ||
          message.includes('Consider marking event handler as \'passive\'') ||
          message.includes('Cannot update server for missing message') ||
          message.includes('No canvas context found')) {
        return;
      }
      originalConsoleWarn.apply(console, args);
    };
    
    console.log = (...args) => {
      const message = args.join(' ');
      // Suppress React DevTools recommendation
      if (message.includes('Download the React DevTools')) {
        return;
      }
      originalConsoleLog.apply(console, args);
    };
  }
}

/**
 * Suppress specific console violations and errors for cleaner development experience
 */
export function suppressViolationWarnings() {
  if (process.env.NODE_ENV === 'development') {
    const originalConsoleError = console.error;
    
    console.error = (...args) => {
      const message = args.join(' ');
      // Suppress known browser extension errors and CORS errors from external services
      if (message.includes('No tab with id:') ||
          message.includes('ERR_FAILED') ||
          message.includes('CORS policy') ||
          message.includes('Uncaught (in promise) Error: No tab with id:') ||
          message.includes('[Violation]') ||
          message.includes('handler took')) {
        return;
      }
      originalConsoleError.apply(console, args);
    };
  }
}
