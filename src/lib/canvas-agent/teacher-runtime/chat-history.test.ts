import { buildTeacherChatHistory, type TranscriptEntry } from './chat-history';

describe('buildTeacherChatHistory', () => {
  it('maps transcript lines into prompt history items', () => {
    const transcript: TranscriptEntry[] = [
      { participantId: 'Alice', text: 'Sketch a hero block.' },
      { participantId: 'Canvas-Agent', text: 'Working on it.' },
      { text: 'Add a sticky note on the right.' },
    ];

    const history = buildTeacherChatHistory({ transcript });

    expect(history).not.toBeNull();
    expect(history).toHaveLength(2);
    expect(history?.[0]).toMatchObject({
      type: 'prompt',
      message: 'Alice: Sketch a hero block.',
    });
    expect(history?.[1]).toMatchObject({
      message: 'Add a sticky note on the right.',
    });
  });

  it('returns null when there is no meaningful transcript content', () => {
    const history = buildTeacherChatHistory({ transcript: [{ participantId: 'agent', text: '' }] });
    expect(history).toBeNull();
  });
});
