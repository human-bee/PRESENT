import { nanoid } from 'nanoid';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 20; // stay comfortably under Linear's 1500/hour allotment

function resolveMaxRequestsPerMinute(): number {
    const envValue = Number(
        process.env.NEXT_PUBLIC_LINEAR_MAX_REQUESTS_PER_MINUTE ||
        process.env.LINEAR_MAX_REQUESTS_PER_MINUTE ||
        DEFAULT_MAX_REQUESTS_PER_MINUTE,
    );

    if (Number.isFinite(envValue) && envValue > 0) {
        // Clamp to avoid accidental bursts
        return Math.min(envValue, 50);
    }

    return DEFAULT_MAX_REQUESTS_PER_MINUTE;
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
                    let errorBody = '';
                    try {
                        errorBody = await response.text();
                    } catch {}
                    console.error('[LinearMcpClient] SSE connection failed', {
                        status: response.status,
                        statusText: response.statusText,
                        body: errorBody,
                        hint: response.status === 401 ? 'API key may be invalid or expired' : undefined,
                    });
                    throw new Error(`SSE connection failed: ${response.status} - ${errorBody || response.statusText}`);
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
                // Stream ended
                this.isConnected = false;
                this.sessionId = null;
                this.connectionPromise = null;
                this.toolsCache = null;
                console.warn('[LinearMcpClient] SSE stream closed');
            }).catch(error => {
                console.error('[LinearMcpClient] SSE Error:', error);
                this.isConnected = false;
                this.sessionId = null;
                this.connectionPromise = null;
                this.toolsCache = null;
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

            if (this.requestTimestamps.length < this.maxRequestsPerMinute) {
                this.requestTimestamps.push(now);
                return;
            }

            const oldest = this.requestTimestamps[0];
            const waitMs = Math.max(50, RATE_LIMIT_WINDOW_MS - (now - oldest));
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
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
            // Network failure: reset and retry once
            this.connectionPromise = null;
            this.sessionId = null;
            this.isConnected = false;
            this.toolsCache = null;
            if (id) this.pendingRequests.delete(id);
            if (attempt === 0) {
                return this.sendJsonRpc<T>(method, params, 1);
            }
            throw err;
        }

        if (!response.ok) {
            if (id) this.pendingRequests.delete(id);
            this.connectionPromise = null;
            this.sessionId = null;
            this.isConnected = false;
            this.toolsCache = null;
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch {}
            console.error('[LinearMcpClient] MCP request failed', {
                method,
                status: response.status,
                statusText: response.statusText,
                body: errorBody,
                hint: response.status === 401 ? 'API key may be invalid or expired' : 
                      response.status === 429 ? 'Rate limited - too many requests' : undefined,
            });
            if (attempt === 0) {
                return this.sendJsonRpc<T>(method, params, 1);
            }
            throw new Error(`MCP request failed: ${response.status} - ${errorBody || response.statusText}`);
        }

        if (isNotification) {
            return { jsonrpc: '2.0', id: '', result: {} as any };
        }

        if (!responsePromise) {
            throw new Error('Response promise not created for non-notification');
        }

        return responsePromise.catch(error => {
            // If it's a notification error, ignore it
            if (method.startsWith('notifications/')) {
                console.warn(`[LinearMcpClient] Ignoring error for notification ${method}:`, error);
                return { jsonrpc: '2.0', id: id || '', result: {} as any };
            }
            // Attempt one reconnect if session died
            if (error instanceof Error && /session id/i.test(error.message)) {
                this.isConnected = false;
                this.sessionId = null;
                this.connectionPromise = null;
                this.toolsCache = null;
                if (attempt === 0) {
                    return this.sendJsonRpc<T>(method, params, 1);
                }
            }
            if (attempt === 0) {
                this.isConnected = false;
                this.sessionId = null;
                this.connectionPromise = null;
                this.toolsCache = null;
                return this.sendJsonRpc<T>(method, params, 1);
            }
            throw error;
        });
    }
}
