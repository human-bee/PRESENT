import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeVoiceTranscript } from '../src/voice/transcript-window';

test('reopened voice panel retains bounded saved history and deduplicates late live echoes', () => {
  const saved = Array.from({ length: 500 }, (_, i) => ({ id: `caption_${i}`, role: 'user' as const, text: `Saved ${i}` }));
  const entries = mergeVoiceTranscript(saved, [{ ...saved[499], text: 'Stale partial', final: false }, { id: 'new', role: 'assistant', text: 'Still speaking', final: false }]);
  assert.equal(entries.length, 60); assert.equal(entries[0].id, 'caption_441');
  assert.equal(entries.at(-2)?.text, 'Saved 499'); assert.equal(entries.at(-2)?.final, true);
  assert.equal(entries.at(-1)?.text, 'Still speaking'); assert.equal(entries.at(-1)?.final, false);
  assert.equal(mergeVoiceTranscript(saved, []).at(-1)?.text, 'Saved 499');
});
