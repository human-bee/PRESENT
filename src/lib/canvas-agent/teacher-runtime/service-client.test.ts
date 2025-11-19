import { createHttpTeacherService } from './service-client';
import type { TeacherPromptContext } from './prompt';

const encoder = new TextEncoder();

describe('createHttpTeacherService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('streams events from NDJSON responses', async () => {
    const chunks = [
      encoder.encode('{"complete":false}\n'),
      encoder.encode('{"complete":true,"actions":[{"id":"1","name":"message","params":{"text":"hi"}}]}\n'),
    ];

    const reader = {
      read: jest
        .fn()
        .mockImplementation(() => {
          if (!chunks.length) return Promise.resolve({ done: true, value: undefined });
          return Promise.resolve({ done: false, value: chunks.shift() });
        }),
    };

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: {
        getReader: () => reader,
      },
    })) as unknown as typeof fetch;

    const service = createHttpTeacherService('http://localhost:8787/');
    const context: TeacherPromptContext = { userMessages: ['hello'], requestType: 'user' };

    const events: unknown[] = [];
    for await (const event of service.stream(context, { dispatchActions: false })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(reader.read).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8787/teacher/stream', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('throws when response is not ok', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    })) as unknown as typeof fetch;

    const service = createHttpTeacherService('http://localhost:8787');
    const context: TeacherPromptContext = { userMessages: ['hi'] };

    await expect(async () => {
      const iterator = service.stream(context, { dispatchActions: false });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of iterator) {
        // no-op
      }
    }).rejects.toThrow('Teacher HTTP error: 503 Service Unavailable');

    expect(global.fetch).toHaveBeenCalled();
  });
});
