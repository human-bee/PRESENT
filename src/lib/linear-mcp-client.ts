import { nanoid } from 'nanoid';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 25; // Linear allows 1500/hour = 25/min average
const DEV_MODE_MAX_REQUESTS_PER_MINUTE = 20; // Still conservative but usable for dev

// Global stats for visibility
export const linearRateLimitStats = {
    requestsThisMinute: 0,
    requestsThisHour: 0,
    lastRequestTime: 0,
    hourStartTime: Date.now(),
    maxPerMinute: DEFAULT_MAX_REQUESTS_PER_MINUTE,
    waitingForRateLimit: false,
    totalRequestsSession: 0,
};

function resolveMaxRequestsPerMinute(): number {
    // In development, use a more conservative limit to avoid hitting Linear's rate limits
    const isDev = process.env.NODE_ENV === 'development' || 
                  process.env.NEXT_PUBLIC_LINEAR_DEV_MODE === 'true';
    
    const envValue = Number(
        process.env.NEXT_PUBLIC_LINEAR_MAX_REQUESTS_PER_MINUTE ||
        process.env.LINEAR_MAX_REQUESTS_PER_MINUTE ||
        (isDev ? DEV_MODE_MAX_REQUESTS_PER_MINUTE : DEFAULT_MAX_REQUESTS_PER_MINUTE),
    );

    let resolved: number;
    if (Number.isFinite(envValue) && envValue > 0) {
        // Clamp to avoid accidental bursts
        resolved = Math.min(envValue, 50);
    } else {
        resolved = isDev ? DEV_MODE_MAX_REQUESTS_PER_MINUTE : DEFAULT_MAX_REQUESTS_PER_MINUTE;
    }

    // Update global stats
    linearRateLimitStats.maxPerMinute = resolved;
    return resolved;
}

// Export function to get current rate limit stats
export function getLinearRateLimitStats() {
    const now = Date.now();
    
    // Reset hour counter if needed
    if (now - linearRateLimitStats.hourStartTime > 60 * 60 * 1000) {
        linearRateLimitStats.requestsThisHour = 0;
        linearRateLimitStats.hourStartTime = now;
    }
    
    return {
        ...linearRateLimitStats,
        minutesUntilReset: Math.ceil((60 * 60 * 1000 - (now - linearRateLimitStats.hourStartTime)) / 60000),
        estimatedRemainingHourly: Math.max(0, 1500 - linearRateLimitStats.requestsThisHour),
    };
}

// --- Types ---

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string;
    method: string;
    params?: any;
}

interface JsonRpcResponse<T = any> {
    jsonrpc: '2.0';
    id: string;
    result?: T;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

// --- Client ---

/**
 * Client for connecting to hosted MCP servers via HTTP.
 * Specifically tailored for Linear's hosted MCP server (HTTP endpoint).
 * 
 * RESPONSIBILITY:
 * - This is a "dumb" client. It does NOT interpret natural language or guess tool names.
 * - It strictly implements the MCP HTTP protocol (tools/list, tools/call).
 * - All "smart" logic (choosing tools, parsing intent) must happen upstream (e.g. in the Steward).
 */
export class LinearMcpClient {
    private pendingRequests = new Map<string | number, { resolve: (value: any) => void; reject: (reason?: any) => void }>();
    private sessionId: string | null = null;
    private isConnected = false;
    private connectionPromise: Promise<void> | null = null;
    private apiKey: string;
    private postUrl: string;
    private toolsCache: McpTool[] | null = null;
    private requestTimestamps: number[] = [];
    private maxRequestsPerMinute: number;
    private lastConnectionError: number = 0;
    private connectionCooldownMs = 5000; // Wait 5s between connection attempts after errors

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        // Base URL for the proxy
        // In Node.js (debug script), we need an absolute URL. In browser, relative is fine.
        const isNode = typeof window === 'undefined';
        const baseUrl = isNode ? 'http://localhost:3000' : '';
        this.postUrl = `${baseUrl}/api/mcp-proxy`;
        this.maxRequestsPerMinute = resolveMaxRequestsPerMinute();
    }

    /**
     * Connects to the Linear MCP server via SSE.
     * Establishes the session and starts listening for messages.
     */
    async connect(): Promise<void> {
        if (this.isConnected) return;
        if (this.connectionPromise) return this.connectionPromise;

        // Respect cooldown after connection errors
        const timeSinceLastError = Date.now() - this.lastConnectionError;
        if (this.lastConnectionError > 0 && timeSinceLastError < this.connectionCooldownMs) {
            const waitTime = this.connectionCooldownMs - timeSinceLastError;
            console.log(`[LinearMcpClient] Waiting ${waitTime}ms before reconnecting (cooldown)`);
            await new Promise(r => setTimeout(r, waitTime));
        }

        this.connectionPromise = new Promise<void>((resolve, reject) => {
            const sseTarget = 'https://mcp.linear.app/sse';
            const url = `${this.postUrl}?target=${encodeURIComponent(sseTarget)}`;

            fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Accept': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                },
            }).then(async (response) => {
                if (!response.ok) {
                    this.connectionPromise = null;
                    throw new Error(`SSE connection failed: ${response.status}`);
                }
                if (!response.body) {
                    this.connectionPromise = null;
                    throw new Error('No body in SSE response');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                // Start reading the stream
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line

                    for (const line of lines) {
                        if (line.startsWith('event: endpoint')) {
                            // Next line should be data: ...
                            continue;
                        }
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();

                            // Check if it's the endpoint (session ID)
                            if (data.startsWith('/')) {
                                this.sessionId = data; // e.g., /mcp?sessionId=...
                                this.isConnected = true;
                                console.log('[LinearMcpClient] Session established:', this.sessionId);
                                resolve();
                                continue;
                            } else {
                                // It's a JSON-RPC message
                                try {
                                    const message = JSON.parse(data);
                                    if (message.id && this.pendingRequests.has(message.id)) {
                                        const { resolve: reqResolve, reject: reqReject } = this.pendingRequests.get(message.id)!;
                                        this.pendingRequests.delete(message.id);
                                        if (message.error) {
                                            console.error(`[LinearMcpClient] JSON-RPC Error received for ID ${message.id}:`, message.error);
                                            reqReject(new Error(message.error.message || JSON.stringify(message.error)));
                                        } else {
                                            reqResolve(message);
                                        }
                                    }
                                } catch (e) {
                                    console.warn('[LinearMcpClient] Failed to parse SSE message:', data);
                                }
                            }
                        }
                    }
                }
                // Stream ended - cleanup AFTER the while loop exits
                this.isConnected = false;
                this.sessionId = null;
                this.connectionPromise = null;
                this.toolsCache = null;
                this.initialized = false;
                this.initializingPromise = null;
                console.warn('[LinearMcpClient] SSE stream closed');
            }).catch(error => {
                console.error('[LinearMcpClient] SSE Error:', error);
                this.isConnected = false;
                this.sessionId = null;
                this.connectionPromise = null;
                this.toolsCache = null;
                this.lastConnectionError = Date.now(); // Track error for cooldown
                // If we reject here, it might be unhandled if the caller isn't awaiting connect() 
                // or if connect() was called as a side effect.
                // But connect() returns a promise that is awaited.
                reject(error);
            });
        });

        return this.connectionPromise;
    }

    /**
     * Fetch the list of available tools from the server.
     * Caches the result for subsequent calls.
     */
    async listTools(forceRefresh = false): Promise<McpTool[]> {
        if (this.toolsCache && !forceRefresh) {
            return this.toolsCache;
        }

        await this.connect();

        // Initialize handshake if needed (Linear seems to require 'initialize' first)
        // But for now let's try calling tools/list directly as some MCP servers allow it.
        // If it fails, we might need to implement the full 'initialize' flow.

        // Note: The verification script showed we need to send 'initialize' first.
        // Let's do a lazy initialization check.
        await this.ensureInitialized();

        const response = await this.sendJsonRpc<any>('tools/list', {});
        if (response.result && Array.isArray(response.result.tools)) {
            this.toolsCache = response.result.tools;
            return this.toolsCache || [];
        }

        return [];
    }

    private initialized = false;
    private initializingPromise: Promise<void> | null = null;

    private async ensureInitialized() {
        if (this.initialized) return;
        if (this.initializingPromise) return this.initializingPromise;

        this.initializingPromise = (async () => {
            await this.sendJsonRpc('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'present-app', version: '1.0' }
            });

            await this.sendJsonRpc('notifications/initialized', {});
            this.initialized = true;
        })();

        return this.initializingPromise;
    }

    private async enforceRateLimit() {
        if (!this.maxRequestsPerMinute || this.maxRequestsPerMinute <= 0) return;

        while (true) {
            const now = Date.now();
            this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

            // Update global stats
            linearRateLimitStats.requestsThisMinute = this.requestTimestamps.length;
            linearRateLimitStats.lastRequestTime = now;
            
            // Reset hourly counter if needed
            if (now - linearRateLimitStats.hourStartTime > 60 * 60 * 1000) {
                linearRateLimitStats.requestsThisHour = 0;
                linearRateLimitStats.hourStartTime = now;
            }

            if (this.requestTimestamps.length < this.maxRequestsPerMinute) {
                this.requestTimestamps.push(now);
                linearRateLimitStats.requestsThisHour++;
                linearRateLimitStats.totalRequestsSession++;
                linearRateLimitStats.waitingForRateLimit = false;
                
                console.log('[LinearMcpClient] Rate limit stats:', {
                    requestsThisMinute: this.requestTimestamps.length,
                    maxPerMinute: this.maxRequestsPerMinute,
                    requestsThisHour: linearRateLimitStats.requestsThisHour,
                    totalSession: linearRateLimitStats.totalRequestsSession,
                });
                return;
            }

            const oldest = this.requestTimestamps[0];
            const waitMs = Math.max(50, RATE_LIMIT_WINDOW_MS - (now - oldest));
            
            linearRateLimitStats.waitingForRateLimit = true;
            console.log('[LinearMcpClient] Rate limit reached, waiting', {
                waitMs,
                requestsThisMinute: this.requestTimestamps.length,
                maxPerMinute: this.maxRequestsPerMinute,
            });
            
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }

    /**
     * Reset all connection state to allow clean reconnection
     */
    private resetConnection() {
        this.connectionPromise = null;
        this.sessionId = null;
        this.isConnected = false;
        this.toolsCache = null;
        this.initialized = false;
        this.initializingPromise = null;
    }

    /**
     * Executes a specific Linear MCP tool.
     * @param toolName The exact name of the tool to execute (e.g., "update_issue", "list_issues")
     * @param params The parameters for the tool
     */
    async executeAction(toolName: string, params: any): Promise<any> {
        console.log(`[LinearMcpClient] Executing tool "${toolName}"`);
        return this.executeTool(toolName, params);
    }

    /**
     * Execute a specific tool on the server by its exact name.
     */
    async executeTool(name: string, args: any): Promise<any> {
        await this.connect();
        await this.ensureInitialized();

        const response = await this.sendJsonRpc<any>('tools/call', {
            name,
            arguments: args,
        });

        if (response.error) {
            throw new Error(response.error.message || 'Unknown tool execution error');
        }

        // MCP tools usually return { content: [{ type: 'text', text: '...' }] }
        if (response.result && response.result.content) {
            const textContent = response.result.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');

            try {
                return JSON.parse(textContent);
            } catch {
                return { result: textContent };
            }
        }

        return response.result;
    }

    /**
     * Helper to send JSON-RPC 2.0 requests
     */
    private async sendJsonRpc<T>(method: string, params: any, attempt = 0): Promise<JsonRpcResponse<T>> {
        if (!this.sessionId) {
            await this.connect();
            if (!this.sessionId) {
                throw new Error('No session ID. Must connect first.');
            }
        }

        const isNotification = method.startsWith('notifications/');
        const id = isNotification ? undefined : nanoid();

        const payload: any = {
            jsonrpc: '2.0',
            method,
            params,
        };

        if (!isNotification) {
            payload.id = id;
        }

        console.log(`[LinearMcpClient] Sending JSON-RPC request: ${method} (id: ${id})`);

        // Construct the session-specific URL
        const linearBase = 'https://mcp.linear.app';
        const targetUrl = `${linearBase}${this.sessionId}`;
        const proxyUrl = `${this.postUrl}?target=${encodeURIComponent(targetUrl)}`;

        // Create a promise that will be resolved by the SSE listener
        let responsePromise: Promise<JsonRpcResponse<T>> | undefined;

        if (!isNotification && id) {
            responsePromise = new Promise<JsonRpcResponse<T>>((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject });
                // Timeout safety
                setTimeout(() => {
                    if (this.pendingRequests.has(id)) {
                        this.pendingRequests.delete(id);
                        console.error(`[LinearMcpClient] Request ${id} timed out after 30s`);
                        reject(new Error('MCP request timed out'));
                    }
                }, 30000);
            });
        }

        await this.enforceRateLimit();

        let response: Response;
        try {
            response = await fetch(proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            // Network failure: reset and retry once with delay
            this.lastConnectionError = Date.now();
            this.resetConnection();
            if (id) this.pendingRequests.delete(id);
            if (attempt === 0) {
                console.log('[LinearMcpClient] Network failure, waiting before retry...');
                await new Promise(r => setTimeout(r, 2000));
                return this.sendJsonRpc<T>(method, params, 1);
            }
            throw err;
        }

        if (!response.ok) {
            if (id) this.pendingRequests.delete(id);
            // Don't aggressively reset on 500 errors - Linear may be rate limiting
            // Only reset if this is clearly a session issue (401/403)
            if (response.status === 401 || response.status === 403) {
                this.resetConnection();
            } else if (response.status === 500) {
                // 500 from Linear MCP often means rate limiting - don't immediately retry
                console.warn(`[LinearMcpClient] Got 500 from Linear - may be rate limited`);
                this.lastConnectionError = Date.now();
            }
            throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
        }

        if (isNotification) {
            return { jsonrpc: '2.0', id: '', result: {} as any };
        }

        if (!responsePromise) {
            throw new Error('Response promise not created for non-notification');
        }

        return responsePromise.catch(async error => {
            // If it's a notification error, ignore it
            if (method.startsWith('notifications/')) {
                console.warn(`[LinearMcpClient] Ignoring error for notification ${method}:`, error);
                return { jsonrpc: '2.0', id: id || '', result: {} as any };
            }
            // Attempt one reconnect if session died or any error on first attempt
            // But add a delay to avoid hammering the server
            if (attempt === 0) {
                console.log(`[LinearMcpClient] Request error, waiting before retry:`, error?.message);
                this.lastConnectionError = Date.now();
                this.resetConnection();
                // Wait before retrying
                await new Promise(r => setTimeout(r, 2000));
                return this.sendJsonRpc<T>(method, params, 1);
            }
            throw error;
        });
    }
}
