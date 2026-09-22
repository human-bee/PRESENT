import { z } from 'zod';
import { AgentError } from '../agents/contract';
export const ACTIVITY_MODEL = 'gpt-5.6-luna';
export async function requestResponse(body: Record<string, unknown>, signal: AbortSignal) {
  if (!process.env.OPENAI_API_KEY) throw new AgentError('Room enrichment is not configured.', 503);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ACTIVITY_MODEL,
      service_tier: 'priority',
      reasoning: { effort: 'none' },
      store: false,
      ...body,
    }),
  });
  if (!response.ok)
    throw new AgentError(
      `Room enrichment returned HTTP ${response.status}. Your conversation is saved.`,
      response.status === 429 ? 429 : 502,
    );
  const raw = await response.json();
  if (raw.status !== 'completed') throw new AgentError('Enrichment did not finish. Your conversation is saved.', 502);
  return raw;
}
export function responseText(raw: { output?: { content?: { type: string; text?: string }[] }[] }): string {
  return (
    raw.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text ?? '')
      .join('') ?? ''
  );
}
export async function structuredResponse<T extends z.ZodType>(
  schema: T,
  name: string,
  instructions: string,
  input: unknown,
  signal: AbortSignal,
) {
  const raw = await requestResponse(
    {
      instructions,
      input: JSON.stringify(input),
      max_output_tokens: 3500,
      text: { format: { type: 'json_schema', name, strict: true, schema: z.toJSONSchema(schema) } },
    },
    signal,
  );
  return {
    value: schema.parse(JSON.parse(responseText(raw))) as z.infer<T>,
    model: raw.model ?? ACTIVITY_MODEL,
    responseId: raw.id as string,
    serviceTier: raw.service_tier as string,
  };
}
