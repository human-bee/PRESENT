import OpenAI from 'openai';
import { fetch as proxyFetch, ProxyAgent } from 'undici';

// Preserve the managed HTTPS proxy and inherited CA trust for SDK requests.
export function createInterviewOpenAI(timeout = 60000) {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const fetcher: typeof globalThis.fetch = dispatcher
    ? (input,init) => proxyFetch(input as Parameters<typeof proxyFetch>[0],{ ...init,dispatcher } as Parameters<typeof proxyFetch>[1]) as unknown as Promise<Response>
    : globalThis.fetch;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY,timeout,maxRetries: 0,fetch: fetcher });
  return { client,close: async () => { await dispatcher?.close(); } };
}
