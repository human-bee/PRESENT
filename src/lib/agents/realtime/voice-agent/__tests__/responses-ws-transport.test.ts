import { ResponsesWebSocketTransport } from '../responses-ws-transport';

type ScriptedEvent = Record<string, unknown>;

let scriptedEvents: ScriptedEvent[] = [];
let sentEvents: Array<Record<string, unknown>> = [];

jest.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWebSocket extends EventEmitter {
    static __setScript(events: ScriptedEvent[]) {
      scriptedEvents = [...events];
    }

    static __reset() {
      scriptedEvents = [];
      sentEvents = [];
    }

    static __sentEvents() {
      return sentEvents;
    }

    constructor(_url: string, _options: Record<string, unknown>) {
      super();
      setTimeout(() => {
        this.emit('open');
      }, 0);
    }

    send(payload: string, cb?: (error?: Error) => void) {
      const parsed = JSON.parse(String(payload)) as Record<string, unknown>;
      sentEvents.push(parsed);
      const nextEvent = scriptedEvents.shift();
      setTimeout(() => {
        if (!nextEvent) {
          const error = new Error('No scripted websocket event');
          this.emit('error', error);
          cb?.(error);
          return;
        }
        this.emit('message', JSON.stringify(nextEvent));
        cb?.();
      }, 0);
    }

    close() {
      this.emit('close');
    }
  }

  return {
    __esModule: true,
    default: MockWebSocket,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MockWebSocket = require('ws').default as {
  __setScript: (events: ScriptedEvent[]) => void;
  __reset: () => void;
  __sentEvents: () => Array<Record<string, unknown>>;
};

describe('ResponsesWebSocketTransport', () => {
  beforeEach(() => {
    MockWebSocket.__reset();
  });

  it('executes tool calls and continues with previous_response_id when store=true', async () => {
    MockWebSocket.__setScript([
      {
        type: 'response.completed',
        response: {
          id: 'resp-1',
          output: [
            {
              type: 'function_call',
              id: 'fc-1',
              call_id: 'call-1',
              name: 'create_component',
              arguments: JSON.stringify({ type: 'RetroTimerEnhanced' }),
            },
          ],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp-2',
          output_text: 'done',
          output: [],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp-3',
          output_text: 'next',
          output: [],
        },
      },
    ]);

    const executeTool = jest.fn(async () => ({ status: 'queued' }));

    const transport = new ResponsesWebSocketTransport({
      apiKey: 'sk-test',
      model: 'gpt-audio-1.5',
      responseTimeoutMs: 15_000,
      store: true,
    });

    const first = await transport.runTurn({
      instructions: 'test instructions',
      userInput: 'start timer',
      tools: [
        {
          name: 'create_component',
          description: 'Create component',
          parameters: { type: 'object' },
        },
      ],
      executeTool,
      toolChoice: 'required',
    });

    const second = await transport.runTurn({
      instructions: 'test instructions',
      userInput: 'continue',
      tools: [],
      executeTool,
      toolChoice: 'required',
    });

    expect(first).toEqual({
      responseId: 'resp-2',
      assistantText: 'done',
      toolCallsExecuted: 1,
    });
    expect(second).toEqual({
      responseId: 'resp-3',
      assistantText: 'next',
      toolCallsExecuted: 0,
    });
    expect(executeTool).toHaveBeenCalledWith('create_component', { type: 'RetroTimerEnhanced' });

    const sent = MockWebSocket.__sentEvents();
    expect((sent[0]?.response as Record<string, unknown>)?.previous_response_id).toBeUndefined();
    expect((sent[1]?.response as Record<string, unknown>)?.previous_response_id).toBe('resp-1');
    expect((sent[2]?.response as Record<string, unknown>)?.previous_response_id).toBe('resp-2');
  });

  it('does not persist previous_response_id when store=false', async () => {
    MockWebSocket.__setScript([
      {
        type: 'response.completed',
        response: {
          id: 'resp-a',
          output_text: 'first',
          output: [],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp-b',
          output_text: 'second',
          output: [],
        },
      },
    ]);

    const transport = new ResponsesWebSocketTransport({
      apiKey: 'sk-test',
      model: 'gpt-audio-1.5',
      store: false,
      responseTimeoutMs: 15_000,
    });

    await transport.runTurn({
      instructions: 'test',
      userInput: 'hello',
      tools: [],
      executeTool: async () => ({ status: 'ok' }),
    });
    await transport.runTurn({
      instructions: 'test',
      userInput: 'hello again',
      tools: [],
      executeTool: async () => ({ status: 'ok' }),
    });

    const sent = MockWebSocket.__sentEvents();
    expect((sent[0]?.response as Record<string, unknown>)?.previous_response_id).toBeUndefined();
    expect((sent[1]?.response as Record<string, unknown>)?.previous_response_id).toBeUndefined();
    expect((sent[0]?.response as Record<string, unknown>)?.store).toBe(false);
    expect((sent[1]?.response as Record<string, unknown>)?.store).toBe(false);
  });
});
