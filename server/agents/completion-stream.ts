import { AgentError } from './contract';

/** Consume content-only SSE chunks; reasoning is never rendered onto the canvas. */
export async function readCompletionStream(response: Response, onDelta: (text: string) => void): Promise<string> {
  if (!response.body) throw new AgentError('The model returned an empty stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', text = '', finished = false;
  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    const value = line.slice(5).trim();
    if (!value || value === '[DONE]') return;
    const chunk = JSON.parse(value);
    if (chunk.error) throw new AgentError('The model stream failed.');
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason === 'length') throw new AgentError('The scene was incomplete. Try a smaller request.');
    if (choice?.finish_reason === 'stop') finished = true;
    if (typeof choice?.delta?.content === 'string') {
      text += choice.delta.content;
      if (text.length > 400000) throw new AgentError('The scene output is too large.');
      onDelta(choice.delta.content);
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) consume(line);
      if (pending.length > 400000) throw new AgentError('The model stream is too large.');
      if (done) { if (pending) consume(pending); break; }
    }
    if (!text || !finished) throw new AgentError('The model stream ended before the scene was complete.');
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
