/**
 * Type for MCP Server entries
 */
export type McpServer = string | {
  url: string;
  transport?: "sse" | "http";
  name?: string;
  timeout?: number;
  retryAttempts?: number;
  enabled?: boolean;
};

/**
 * MCP Server status tracking
 */
interface McpServerStatus {
  url: string;
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
  lastAttempt: number;
  failureCount: number;
  lastError?: string;
}

// Global status tracking to prevent excessive retries
const serverStatusMap = new Map<string, McpServerStatus>();
const MAX_FAILURES = 3;
const FAILURE_BACKOFF_TIME = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a server should be attempted based on failure history
 */
function shouldAttemptConnection(url: string): boolean {
  const status = serverStatusMap.get(url);
  if (!status) return true;
  
  if (status.status === 'connected') return true;
  if (status.status === 'disabled') return false;
  
  // If we've had too many failures, check if enough time has passed
  if (status.failureCount >= MAX_FAILURES) {
    const timeSinceLastAttempt = Date.now() - status.lastAttempt;
    if (timeSinceLastAttempt < FAILURE_BACKOFF_TIME) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[MCP] Skipping ${url} - too many failures, backing off`);
      }
      return false;
    } else {
      // Reset failure count after backoff period
      status.failureCount = 0;
    }
  }
  
  return true;
}

/**
 * Update server status after connection attempt
 */
function updateServerStatus(url: string, success: boolean, error?: string) {
  const existing = serverStatusMap.get(url);
  const status: McpServerStatus = existing || {
    url,
    status: 'connecting',
    lastAttempt: Date.now(),
    failureCount: 0
  };
  
  status.lastAttempt = Date.now();
  
  if (success) {
    status.status = 'connected';
    status.failureCount = 0;
    status.lastError = undefined;
  } else {
    status.status = 'failed';
    status.failureCount++;
    status.lastError = error;
    
    // Disable server if too many failures
    if (status.failureCount >= MAX_FAILURES) {
      status.status = 'disabled';
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[MCP] Disabling server ${url} after ${MAX_FAILURES} failures. Will retry in ${FAILURE_BACKOFF_TIME/60000} minutes.`);
      }
    }
  }
  
  serverStatusMap.set(url, status);
}

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
    const deduplicatedServers = servers
      .filter((server: McpServer) => {
        const url = typeof server === "string" ? server : server.url;
        if (uniqueUrls.has(url)) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[MCP] Duplicate server URL found, skipping: ${url}`);
          }
          return false;
        }
        uniqueUrls.add(url);
        return true;
      })
      .filter((server: McpServer) => {
        // Filter out servers that shouldn't be attempted due to failures
        const url = typeof server === "string" ? server : server.url;
        return shouldAttemptConnection(url);
      })
      .map((server: McpServer) => {
        // Add default timeout and retry settings if not specified
        if (typeof server === "string") {
          return {
            url: server,
            transport: "sse" as const,
            timeout: 10000, // 10 seconds
            retryAttempts: 2,
            enabled: true
          };
        } else {
          return {
            ...server,
            timeout: server.timeout || 10000,
            retryAttempts: server.retryAttempts || 2,
            enabled: server.enabled !== false
          };
        }
      });
    
    // Log loading info in development
    if (process.env.NODE_ENV === 'development' && deduplicatedServers.length > 0) {
      console.log(`[MCP] Loading ${deduplicatedServers.length} MCP server(s)`);
      
      // Show which servers are being skipped
      const skippedServers = servers.length - deduplicatedServers.length;
      if (skippedServers > 0) {
        console.log(`[MCP] Skipping ${skippedServers} server(s) due to failures or duplicates`);
      }
    }
    
    return deduplicatedServers;
  } catch (e) {
    console.error("Failed to parse saved MCP servers", e);
    return [];
  }
}

/**
 * Mark an MCP server as failed (called by MCP provider on connection failure)
 */
export function markMcpServerFailed(url: string, error?: string) {
  updateServerStatus(url, false, error);
}

/**
 * Mark an MCP server as connected (called by MCP provider on successful connection)
 */
export function markMcpServerConnected(url: string) {
  updateServerStatus(url, true);
}

/**
 * Get the status of all MCP servers
 */
export function getMcpServerStatuses(): Map<string, McpServerStatus> {
  return new Map(serverStatusMap);
}

/**
 * Reset server failure counts (useful for manual retry)
 */
export function resetMcpServerFailures() {
  serverStatusMap.clear();
  if (process.env.NODE_ENV === 'development') {
    console.log('[MCP] Server failure counts reset');
  }
}

/**
 * Suppress console warnings in development mode for cleaner logs
 */
export function suppressDevelopmentWarnings() {
  if (process.env.NODE_ENV === 'development') {
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    console.warn = (...args) => {
      // Suppress known tool overwrite warnings from Tambo MCP provider
      const message = args.join(' ');
      if (message.includes('Overwriting tool') || 
          message.includes('TamboRegistryProvider') ||
          message.includes('Added non-passive event listener') ||
          message.includes('Consider marking event handler as \'passive\'') ||
          message.includes('Cannot update server for missing message') ||
          message.includes('No canvas context found') ||
          message.includes('Audio loading failed, will use fallback sound') ||
          message.includes('Agent dispatch timeout')) {
        return;
      }
      originalConsoleWarn.apply(console, args);
    };
    
    console.log = (...args) => {
      const message = args.join(' ');
      // Suppress React DevTools recommendation and repetitive MCP messages
      if (message.includes('Download the React DevTools') ||
          message.includes('handler took') && message.includes('ms')) {
        return;
      }
      originalConsoleLog.apply(console, args);
    };

    console.error = (...args) => {
      const message = args.join(' ');
      // Suppress known browser extension errors and CORS errors from external services
      if (message.includes('No tab with id:') ||
          message.includes('ERR_FAILED') ||
          message.includes('CORS policy') ||
          message.includes('net::ERR_FAILED 524') ||
          message.includes('net::ERR_FAILED 404') ||
          message.includes('Uncaught (in promise) Error: No tab with id:') ||
          message.includes('Access to fetch at') ||
          message.includes('Access to audio at') ||
          message.includes('from origin') ||
          message.includes('background.js:')) {
        return;
      }
      originalConsoleError.apply(console, args);
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
          message.includes('handler took') ||
          message.includes('MCP error -32001: Request timed out') ||
          message.includes('Failed to register tools from MCP servers')) {
        return;
      }
      originalConsoleError.apply(console, args);
    };
  }
}
