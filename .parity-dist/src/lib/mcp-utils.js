/**
 * Type for MCP Server entries
 */
import { createLogger } from '@/lib/utils';
// Global status tracking to prevent excessive retries
const serverStatusMap = new Map();
const MAX_FAILURES = 3;
const FAILURE_BACKOFF_TIME = 5 * 60 * 1000; // 5 minutes
/**
 * Check if a server should be attempted based on failure history
 */
function shouldAttemptConnection(url) {
    const status = serverStatusMap.get(url);
    if (!status)
        return true;
    if (status.status === 'connected')
        return true;
    if (status.status === 'disabled')
        return false;
    // If we've had too many failures, check if enough time has passed
    if (status.failureCount >= MAX_FAILURES) {
        const timeSinceLastAttempt = Date.now() - status.lastAttempt;
        if (timeSinceLastAttempt < FAILURE_BACKOFF_TIME) {
            if (process.env.NODE_ENV === 'development') {
                try {
                    createLogger('MCP').info(`Skipping ${url} - too many failures, backing off`);
                }
                catch { }
            }
            return false;
        }
        else {
            // Reset failure count after backoff period
            status.failureCount = 0;
        }
    }
    return true;
}
/**
 * Update server status after connection attempt
 */
function updateServerStatus(url, success, error) {
    const existing = serverStatusMap.get(url);
    const status = existing || {
        url,
        status: 'connecting',
        lastAttempt: Date.now(),
        failureCount: 0,
    };
    status.lastAttempt = Date.now();
    if (success) {
        status.status = 'connected';
        status.failureCount = 0;
        status.lastError = undefined;
    }
    else {
        status.status = 'failed';
        status.failureCount++;
        status.lastError = error;
        // Disable server if too many failures
        if (status.failureCount >= MAX_FAILURES) {
            status.status = 'disabled';
            if (process.env.NODE_ENV === 'development') {
                try {
                    createLogger('MCP').warn(`Disabling server ${url} after ${MAX_FAILURES} failures. Will retry in ${FAILURE_BACKOFF_TIME / 60000} minutes.`);
                }
                catch { }
            }
        }
    }
    serverStatusMap.set(url, status);
}
/**
 * Simple URL validation utility. Accepts absolute URLs (http/https) and
 * application-relative paths that start with "/". Returns `true` if the input
 * can be successfully resolved to a valid URL, otherwise `false`.
 */
function isValidMcpUrl(raw) {
    if (!raw || typeof raw !== 'string')
        return false;
    // Allow relative API routes ("/api/…") which the runtime will prepend with the current origin.
    if (raw.startsWith('/'))
        return true;
    try {
        // Will throw for invalid absolute URLs (e.g. empty string, missing protocol, etc.)
        new URL(raw);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Load and process MCP server configurations from localStorage
 */
export function loadMcpServers() {
    if (typeof window === 'undefined')
        return [];
    const savedServersData = localStorage.getItem('mcp-servers');
    if (!savedServersData)
        return [];
    try {
        const servers = JSON.parse(savedServersData);
        // Deduplicate servers by URL to prevent multiple tool registrations
        const uniqueUrls = new Set();
        // Track logs to avoid noisy duplicates in dev / strict mode
        const loggedProxy = window.__mcp_logged_proxy__ || new Set();
        window.__mcp_logged_proxy__ = loggedProxy;
        const deduplicatedServers = servers
            .filter((server) => {
            const url = typeof server === 'string' ? server : server.url;
            // Skip obviously invalid entries early to avoid runtime failures later.
            if (!isValidMcpUrl(url)) {
                if (process.env.NODE_ENV === 'development') {
                    try {
                        createLogger('MCP').warn(`Invalid MCP server URL detected, skipping: "${url}"`);
                    }
                    catch { }
                }
                return false;
            }
            if (uniqueUrls.has(url)) {
                if (process.env.NODE_ENV === 'development') {
                    try {
                        createLogger('MCP').info(`Duplicate server URL found, skipping: ${url}`);
                    }
                    catch { }
                }
                return false;
            }
            uniqueUrls.add(url);
            return true;
        })
            .filter((server) => {
            // Filter out servers that shouldn't be attempted due to failures
            const url = typeof server === 'string' ? server : server.url;
            return shouldAttemptConnection(url);
        })
            .map((server) => {
            // Add default timeout and retry settings if not specified
            let processedServer;
            if (typeof server === 'string') {
                processedServer = {
                    url: server,
                    transport: 'sse',
                    timeout: 10000, // 10 seconds
                    retryAttempts: 2,
                    enabled: true,
                };
            }
            else {
                processedServer = {
                    ...server,
                    timeout: server.timeout || 10000,
                    retryAttempts: server.retryAttempts || 2,
                    enabled: server.enabled !== false,
                };
            }
            // Proxy external MCP servers to avoid CORS issues
            const url = typeof processedServer === 'string' ? processedServer : processedServer.url;
            // Check if this is an external URL that needs proxying
            if (url &&
                !url.startsWith('http://localhost') &&
                !url.startsWith('http://127.0.0.1') &&
                !url.startsWith('/')) {
                if (process.env.NODE_ENV === 'development' && !loggedProxy.has(url)) {
                    try {
                        createLogger('MCP').info(`Proxying external server: ${url}`);
                    }
                    catch { }
                    loggedProxy.add(url);
                }
                // Update the URL to use our proxy
                const proxiedUrl = `/api/mcp-proxy?target=${encodeURIComponent(url)}`;
                if (typeof processedServer === 'string') {
                    processedServer = proxiedUrl;
                }
                else {
                    processedServer.url = proxiedUrl;
                    // Keep original transport type - our proxy supports both SSE and HTTP
                    // processedServer.transport remains unchanged
                }
            }
            return processedServer;
        });
        // Log loading info in development
        if (process.env.NODE_ENV === 'development' && deduplicatedServers.length > 0) {
            const g = window;
            const key = '__mcp_last_count__';
            if (g[key] !== deduplicatedServers.length) {
                try {
                    createLogger('MCP').info(`Loading ${deduplicatedServers.length} MCP server(s)`);
                }
                catch { }
                g[key] = deduplicatedServers.length;
            }
            // Show which servers are being skipped
            const skippedServers = servers.length - deduplicatedServers.length;
            if (skippedServers > 0) {
                try {
                    createLogger('MCP').info(`Skipping ${skippedServers} server(s) due to failures or duplicates`);
                }
                catch { }
            }
        }
        return deduplicatedServers;
    }
    catch (e) {
        try {
            createLogger('MCP').error('Failed to parse saved MCP servers', e);
        }
        catch { }
        return [];
    }
}
/**
 * Mark an MCP server as failed (called by MCP provider on connection failure)
 */
export function markMcpServerFailed(url, error) {
    updateServerStatus(url, false, error);
}
/**
 * Mark an MCP server as connected (called by MCP provider on successful connection)
 */
export function markMcpServerConnected(url) {
    updateServerStatus(url, true);
}
/**
 * Get the status of all MCP servers
 */
export function getMcpServerStatuses() {
    return new Map(serverStatusMap);
}
/**
 * Reset server failure counts (useful for manual retry)
 */
export function resetMcpServerFailures() {
    serverStatusMap.clear();
    if (process.env.NODE_ENV === 'development') {
        try {
            createLogger('MCP').info('Server failure counts reset');
        }
        catch { }
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
            // Suppress known tool overwrite warnings from custom MCP provider
            const message = args.join(' ');
            if (message.includes('Overwriting tool') ||
                message.includes('customRegistryProvider') ||
                message.includes('Added non-passive event listener') ||
                message.includes("Consider marking event handler as 'passive'") ||
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
                (message.includes('handler took') && message.includes('ms'))) {
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
/**
 * Global MCP error handler
 */
export function setupGlobalMcpErrorHandler() {
    if (typeof window === 'undefined')
        return;
    // Handle unhandled promise rejections related to MCP
    const handleUnhandledRejection = (event) => {
        if (event.reason?.message?.includes('Transport is closed') ||
            event.reason?.message?.includes('HTTP 400') ||
            event.reason?.message?.includes('streamableHttp')) {
            console.warn('[MCP Global Handler] Transport error detected:', event.reason?.message);
            // Mark the failing server as temporarily disabled
            const failedUrl = extractUrlFromError(event.reason?.message || '');
            if (failedUrl) {
                markMcpServerFailed(failedUrl, event.reason?.message || 'Transport closed');
            }
            // Show user-friendly notification
            showMcpErrorNotification('Connection to external services temporarily unavailable. Components will work with reduced functionality.');
            // Prevent the error from bubbling up and breaking the UI
            event.preventDefault();
        }
    };
    // Handle general errors that might be MCP-related
    const handleError = (event) => {
        if (event.message?.includes('Transport is closed') ||
            event.message?.includes('streamableHttp')) {
            console.warn('[MCP Global Handler] Error detected:', event.message);
            event.preventDefault();
        }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);
    // Return cleanup function
    return () => {
        window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        window.removeEventListener('error', handleError);
    };
}
/**
 * Extract URL from error message
 */
function extractUrlFromError(errorMessage) {
    // Try to extract URL patterns from error messages
    const urlMatch = errorMessage.match(/https?:\/\/[^\s]+/);
    return urlMatch ? urlMatch[0] : null;
}
/**
 * Show user-friendly MCP error notification
 */
function showMcpErrorNotification(message) {
    // Check if we're in a browser environment and have a way to show notifications
    if (typeof window !== 'undefined') {
        // Try to use toast notification if available
        if (window.dispatchEvent) {
            const toastEvent = new CustomEvent('mcp-error', {
                detail: { message, type: 'warning' },
            });
            window.dispatchEvent(toastEvent);
        }
        // Fallback to console warning
        console.warn(`[MCP] ${message}`);
    }
}
//# sourceMappingURL=mcp-utils.js.map