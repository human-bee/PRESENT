// Controlled model discovery only; this fixture cannot issue a paid response.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
if (!process.env.CODEX_HOME || !existsSync(join(process.env.CODEX_HOME, 'CONTROLLED_TEST_ONLY'))) throw new Error('Disposable controlled discovery directory required.');
globalThis.fetch = async input => {
  if (String(input) !== 'https://api.openai.com/v1/models') throw new Error('Unexpected network request in controlled planning fixture.');
  return new Response(JSON.stringify({ data: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'].map(id => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
};
