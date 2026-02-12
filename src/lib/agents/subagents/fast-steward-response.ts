type JsonObject = Record<string, unknown>;

const asRecord = (value: unknown): JsonObject | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
};

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export type FastStewardResponse =
  | {
      ok: true;
      message: JsonObject;
      response: JsonObject;
    }
  | {
      ok: false;
      reason: string;
      response: unknown;
    };

export type ExtractedToolCall = {
  name: string;
  argumentsRaw: string;
  raw: JsonObject;
};

export type ParseToolArgumentsResult =
  | {
      ok: true;
      args: JsonObject;
    }
  | {
      ok: false;
      error: string;
      raw: string;
    };

export function extractFirstMessage(response: unknown): FastStewardResponse {
  const responseRecord = asRecord(response);
  if (!responseRecord) {
    return { ok: false, reason: 'Response is not an object', response };
  }

  const choices = responseRecord.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, reason: 'Response choices are missing', response };
  }

  const firstChoice = asRecord(choices[0]);
  if (!firstChoice) {
    return { ok: false, reason: 'First choice is not an object', response };
  }

  const message = asRecord(firstChoice.message);
  if (!message) {
    return { ok: false, reason: 'First choice message is missing', response };
  }

  return { ok: true, message, response: responseRecord };
}

export function extractFirstMessageContent(response: unknown): string {
  const parsed = extractFirstMessage(response);
  if (!parsed.ok) return '';

  const content = parsed.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const first = asRecord(content[0]);
  if (!first) return '';
  const text = asString(first.text);
  return text ?? '';
}

export function extractFirstToolCall(response: unknown): ExtractedToolCall | null {
  const parsed = extractFirstMessage(response);
  if (!parsed.ok) return null;

  const toolCalls = parsed.message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const toolCall = asRecord(toolCalls[0]);
    if (!toolCall) return null;

    const fn = asRecord(toolCall.function);
    if (!fn) return null;

    const name = asString(fn.name);
    const argumentsRaw = asString(fn.arguments);
    if (!name || argumentsRaw === null) return null;

    return {
      name,
      argumentsRaw,
      raw: toolCall,
    };
  }

  // Backward compatibility for providers that return legacy function_call shape.
  const legacyFunctionCall = asRecord(parsed.message.function_call);
  if (!legacyFunctionCall) return null;
  const name = asString(legacyFunctionCall.name);
  const argumentsRaw = asString(legacyFunctionCall.arguments);
  if (!name || argumentsRaw === null) return null;
  return {
    name,
    argumentsRaw,
    raw: legacyFunctionCall,
  };
}

export function parseToolArgumentsResult(raw: string): ParseToolArgumentsResult {
  try {
    const parsed = JSON.parse(raw);
    const args = asRecord(parsed);
    if (!args) {
      return { ok: false, error: 'Tool arguments must be a JSON object', raw };
    }
    return { ok: true, args };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse tool arguments',
      raw,
    };
  }
}

export function parseToolArguments(raw: string): JsonObject | null {
  const parsed = parseToolArgumentsResult(raw);
  return parsed.ok ? parsed.args : null;
}
