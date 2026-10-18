/** @jest-environment node */
import { bindCurrentUtteranceSuggestions, buildSuggestionInput, suggestFromTranscript, validateSuggestions } from './agent';
import { createBriefDocument, exampleProfile } from './seed';
import { readBrief } from './document';

const transcript = { id: 'candidate-1', text: 'I built the API. Ana owned the UI.', speaker: 'Candidate', timestamp: 1, example: false };
const suggestion = { field: 'work', text: 'Built the API; Ana owned the UI.', quote: 'I built the API. Ana owned the UI.', transcriptId: 'candidate-1' };

describe('interview agent evidence contract', () => {
  it('never asks the model to turn a recruiter question into candidate evidence', async () => {
    const doc = createBriefDocument(exampleProfile, false);
    await expect(suggestFromTranscript(readBrief(doc), { ...transcript, role: 'recruiter', speaker: 'Recruiter', text: 'What did you personally build?' })).resolves.toEqual([]);
    doc.destroy();
  });
  it('binds model output to the current server-owned utterance ID while validating its quote', () => {
    const current = { ...transcript, id: '8f0962aa-7f7e-47cc-b2a7-e2568aa73283' };
    const { transcriptId: _id, quote: _quote, ...addition } = suggestion;
    expect(bindCurrentUtteranceSuggestions({ suggestions: [addition] }, current)[0].transcriptId).toBe(current.id);
    expect(bindCurrentUtteranceSuggestions({ suggestions: [addition] }, current)[0].quote).toBe(current.text);
    expect(() => bindCurrentUtteranceSuggestions({ suggestions: [{ ...addition, quote: 'An invented quote.' }] }, current)).toThrow();
    expect(() => bindCurrentUtteranceSuggestions({ suggestions: [suggestion] }, current)).toThrow();
  });
  it('keeps exact transcript evidence on a proposed addition', () => {
    expect(validateSuggestions({ suggestions: [suggestion] }, transcript)).toEqual([
      expect.objectContaining({ ...suggestion, id: expect.any(String), status: 'pending' }),
    ]);
  });
  it('drops invented quotes and references to a different utterance', () => {
    expect(validateSuggestions({ suggestions: [
      { ...suggestion, quote: 'I owned the whole product.' },
      { ...suggestion, transcriptId: 'unrelated-note' },
    ] }, transcript)).toEqual([]);
  });
  it('rejects unsupported assessment fields and excessive additions', () => {
    expect(() => validateSuggestions({ suggestions: [{ ...suggestion, field: 'fitScore' }] }, transcript)).toThrow();
    expect(() => validateSuggestions({ suggestions: [suggestion, suggestion, suggestion] }, transcript)).toThrow();
  });
  it('supports sourced profile details without accepting inferred scoring fields', () => {
    expect(validateSuggestions({ suggestions: [{ ...suggestion, field: 'location', text: 'Seattle' }] }, transcript)[0].field).toBe('location');
  });
  it('includes bounded preceding dialogue while retaining the full current evidence', () => {
    const doc = createBriefDocument(exampleProfile, false);
    const snapshot = readBrief(doc);
    snapshot.transcripts = Array.from({ length: 10 }, (_, index) => ({ ...transcript, id: `turn-${index}`, text: 'x'.repeat(3000) }));
    snapshot.transcripts.push(transcript, { ...transcript, id: 'later', text: 'A later answer.' });
    const input = buildSuggestionInput(snapshot, transcript);
    expect(input.recentConversation).toHaveLength(6);
    expect(input.recentConversation.every((turn) => turn.text.length <= 1200)).toBe(true);
    expect(input.recentConversation.map((turn) => turn.id)).not.toContain('later');
    expect(input.currentUtterance).toEqual(transcript);
    expect(validateSuggestions({ suggestions: [{ ...suggestion, transcriptId: 'turn-9' }] }, transcript)).toEqual([]);
    doc.destroy();
  });
});
