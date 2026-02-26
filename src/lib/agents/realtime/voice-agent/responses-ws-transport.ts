import WebSocket from 'ws';

export type VoiceTransportTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type FunctionCallOutput = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

type FunctionCallRequest = {
  id: string;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ResponseCreatePayload = {
  instructions: string;
  input: Array<Record<string, unknown>>;
  tools: VoiceTransportTool[];
  toolChoice: 'required' | 'auto';
  previousResponseId: string | null;
};

export type RunTurnInput = {
  instructions: string;
  userInput?: string;
  tools: VoiceTransportTool[];
  toolChoice?: 'required' | 'auto';
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type RunTurnResult = {
  responseId: string | null;
  assistantText: string;
  toolCallsExecuted: number;
};

export type VoiceModelTransport = {
  runTurn(input: RunTurnInput): Promise<RunTurnResult>;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseJsonRecord = (value: unknown): JsonRecord => {
  if (!isRecord(value)) return {};
  return value;
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ status: 'serialization_error' });
  }
};

const normalizeTextInput = (value?: string): string => {
  const next = (value || '').trim();
  return next.length > 0 ? next : 'continue';
};

const extractResponseId = (response: unknown): string | null => {
  if (!isRecord(response)) return null;
  const id = response.id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
};

const extractAssistantText = (response: unknown): string => {
  if (!isRecord(response)) return '';
  const outputText = response.output_text;
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    return outputText.trim();
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      const text =
        typeof part.text === 'string'
          ? part.text
          : typeof part.value === 'string'
            ? part.value
            : undefined;
      if (text && text.trim().length > 0) {
        chunks.push(text.trim());
      }
    }
  }
  return chunks.join('\n').trim();
};

const parseFunctionCall = (item: unknown): FunctionCallRequest | null => {
  if (!isRecord(item)) return null;
  if (item.type !== 'function_call') return null;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!name) return null;
  const callIdRaw = item.call_id ?? item.id;
  const callId = typeof callIdRaw === 'string' ? callIdRaw.trim() : '';
  if (!callId) return null;
  const idRaw = item.id ?? callId;
  const id = typeof idRaw === 'string' && idRaw.trim().length > 0 ? idRaw.trim() : callId;
  let args: Record<string, unknown> = {};
  const rawArgs = item.arguments;
  if (typeof rawArgs === 'string' && rawArgs.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawArgs);
      args = parseJsonRecord(parsed);
    } catch {
      args = {};
    }
  } else if (isRecord(rawArgs)) {
    args = rawArgs;
  }
  return { id, callId, name, arguments: args };
};

const extractFunctionCalls = (response: unknown): FunctionCallRequest[] => {
  if (!isRecord(response)) return [];
  const output = Array.isArray(response.output) ? response.output : [];
  const calls: FunctionCallRequest[] = [];
  for (const item of output) {
    const parsed = parseFunctionCall(item);
    if (parsed) calls.push(parsed);
  }
  return calls;
};

type PendingResponse = {
  resolve: (value: JsonRecord) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class ResponsesWebSocketTransport implements VoiceModelTransport {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly responseTimeoutMs: number;
  private readonly store: boolean;
  private previousResponseId: string | null = null;

  constructor(options: {
    apiKey: string;
    model: string;
    endpoint?: string;
    responseTimeoutMs?: number;
    store?: boolean;
  }) {
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.endpoint = options.endpoint?.trim() || 'wss://api.openai.com/v1/responses';
    const timeoutCandidate =
      typeof options.responseTimeoutMs === 'number' && Number.isFinite(options.responseTimeoutMs)
        ? options.responseTimeoutMs
        : 45_000;
    this.responseTimeoutMs = Math.max(500, Math.min(180_000, Math.floor(timeoutCandidate)));
    this.store = options.store !== false;
  }

  private async withSocket<T>(run: (ws: WebSocket) => Promise<T>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Missing OPENAI_API_KEY for Responses WebSocket transport');
    }
    if (!this.model) {
      throw new Error('Missing Responses model for WebSocket transport');
    }

    const ws = new WebSocket(this.endpoint, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Responses WebSocket connection timed out'));
      }, this.responseTimeoutMs);
      ws.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    try {
      return await run(ws);
    } finally {
      try {
        ws.close();
      } catch {
        // noop
      }
    }
  }

  private async sendAndAwaitCompleted(ws: WebSocket, payload: ResponseCreatePayload): Promise<JsonRecord> {
    return new Promise<JsonRecord>((resolve, reject) => {
      const cleanup = () => {
        ws.off('message', handleMessage);
        ws.off('error', handleError);
        ws.off('close', handleClose);
      };
      let pending: PendingResponse | null = {
        resolve: (value) => {
          if (!pending) return;
          clearTimeout(pending.timeout);
          cleanup();
          pending = null;
          resolve(value);
        },
        reject: (error) => {
          if (!pending) return;
          clearTimeout(pending.timeout);
          cleanup();
          pending = null;
          reject(error);
        },
        timeout: setTimeout(() => {
          if (!pending) return;
          const timeoutError = new Error('Timed out waiting for response.completed event');
          pending.reject(timeoutError);
        }, this.responseTimeoutMs),
      };

      const handleMessage = (data: WebSocket.RawData) => {
        if (!pending) return;
        const text = typeof data === 'string' ? data : data.toString();
        let event: JsonRecord;
        try {
          const parsed = JSON.parse(text);
          event = parseJsonRecord(parsed);
        } catch {
          return;
        }

        const type = typeof event.type === 'string' ? event.type : '';
        if (type === 'error') {
          const err = parseJsonRecord(event.error);
          const message =
            typeof err.message === 'string'
              ? err.message
              : typeof event.message === 'string'
                ? event.message
                : 'Responses WebSocket error';
          pending.reject(new Error(message));
          return;
        }
        if (type === 'response.failed') {
          const response = parseJsonRecord(event.response);
          const message =
            typeof response.error === 'string'
              ? response.error
              : typeof event.message === 'string'
                ? event.message
                : 'Responses WebSocket response failed';
          pending.reject(new Error(message));
          return;
        }
        if (type === 'response.completed') {
          const response = parseJsonRecord(event.response);
          pending.resolve(response);
        }
      };

      const handleError = (error: Error) => {
        pending?.reject(error instanceof Error ? error : new Error(String(error)));
      };
      const handleClose = () => {
        if (pending) {
          pending.reject(new Error('Responses WebSocket closed before completion'));
        }
      };

      ws.on('message', handleMessage);
      ws.on('error', handleError);
      ws.on('close', handleClose);

      const event = {
        type: 'response.create',
        response: {
          model: this.model,
          instructions: payload.instructions,
          input: payload.input,
          tools: payload.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
          tool_choice: payload.toolChoice,
          ...(payload.previousResponseId ? { previous_response_id: payload.previousResponseId } : {}),
          ...(this.store ? {} : { store: false }),
        },
      };

      ws.send(JSON.stringify(event), (error) => {
        if (error) {
          pending?.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const textInput = normalizeTextInput(input.userInput);
    const loopCap = 8;
    let assistantText = '';
    let executed = 0;
    let latestResponseId: string | null = null;
    let previousResponseId = this.previousResponseId;

    const firstInput: Array<Record<string, unknown>> = [
      {
        role: 'user',
        content: [{ type: 'input_text', text: textInput }],
      },
    ];

    await this.withSocket(async (ws) => {
      let pendingInput = firstInput;
      for (let loop = 0; loop < loopCap; loop += 1) {
        const response = await this.sendAndAwaitCompleted(ws, {
          instructions: input.instructions,
          input: pendingInput,
          tools: input.tools,
          toolChoice: input.toolChoice ?? 'required',
          previousResponseId,
        });
        latestResponseId = extractResponseId(response);
        if (latestResponseId) {
          previousResponseId = latestResponseId;
        }

        const text = extractAssistantText(response);
        if (text) {
          assistantText = text;
        }

        const calls = extractFunctionCalls(response);
        if (calls.length === 0) {
          break;
        }

        const toolOutputs: FunctionCallOutput[] = [];
        for (const call of calls) {
          const result = await input.executeTool(call.name, call.arguments);
          toolOutputs.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: safeStringify(result ?? { status: 'ok' }),
          });
          executed += 1;
        }
        if (loop === loopCap - 1) {
          throw new Error('Responses WebSocket tool loop exceeded max iterations');
        }
        pendingInput = toolOutputs;
      }
    });

    if (this.store && latestResponseId) {
      this.previousResponseId = latestResponseId;
    }

    return {
      responseId: latestResponseId,
      assistantText,
      toolCallsExecuted: executed,
    };
  }
}
