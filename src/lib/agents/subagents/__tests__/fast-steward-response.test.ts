import {
  extractFirstMessage,
  extractFirstMessageContent,
  extractFirstToolCall,
  parseToolArguments,
  parseToolArgumentsResult,
} from '../fast-steward-response';

describe('fast-steward-response', () => {
  it('extracts first tool call from a valid completion response', () => {
    const response = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'commit_action',
                  arguments: '{"kind":"search","query":"abc"}',
                },
              },
            ],
          },
        },
      ],
    };

    const toolCall = extractFirstToolCall(response);
    expect(toolCall).toEqual({
      name: 'commit_action',
      argumentsRaw: '{"kind":"search","query":"abc"}',
      raw: {
        function: {
          name: 'commit_action',
          arguments: '{"kind":"search","query":"abc"}',
        },
      },
    });
  });

  it('returns null when tool call shape is invalid', () => {
    const response = {
      choices: [{ message: { tool_calls: [{ function: { name: 'commit_action' } }] } }],
    };
    expect(extractFirstToolCall(response)).toBeNull();
  });

  it('falls back to legacy function_call shape when tool_calls are absent', () => {
    const response = {
      choices: [
        {
          message: {
            function_call: {
              name: 'commit_action',
              arguments: '{"kind":"search","query":"legacy"}',
            },
          },
        },
      ],
    };
    expect(extractFirstToolCall(response)).toEqual({
      name: 'commit_action',
      argumentsRaw: '{"kind":"search","query":"legacy"}',
      raw: {
        name: 'commit_action',
        arguments: '{"kind":"search","query":"legacy"}',
      },
    });
  });

  it('returns structured parse errors for invalid tool arguments', () => {
    const result = parseToolArgumentsResult('{bad-json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.raw).toBe('{bad-json');
    }
  });

  it('parses tool arguments object and rejects non-object roots', () => {
    expect(parseToolArguments('{"kind":"create"}')).toEqual({ kind: 'create' });
    expect(parseToolArguments('["x"]')).toBeNull();
  });

  it('extracts message content from string and tool content arrays', () => {
    const direct = extractFirstMessageContent({
      choices: [{ message: { content: 'hello world' } }],
    });
    expect(direct).toBe('hello world');

    const arrayText = extractFirstMessageContent({
      choices: [{ message: { content: [{ text: 'from-array' }] } }],
    });
    expect(arrayText).toBe('from-array');
  });

  it('returns invalid response state when choices are missing', () => {
    const parsed = extractFirstMessage({ foo: 'bar' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain('choices');
    }
  });
});
