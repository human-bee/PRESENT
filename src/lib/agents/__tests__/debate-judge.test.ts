jest.mock('@openai/agents', () => ({
  tool: (config: unknown) => config,
  Agent: class {},
  run: jest.fn(),
}));

import { commit_scorecard } from '@/lib/agents/debate-judge';
import { debateScorecardStateSchema } from '@/lib/agents/debate-scorecard-schema';

jest.mock('@/lib/agents/shared/supabase-context', () => ({
  commitDebateScorecard: jest.fn(),
  getDebateScorecard: jest.fn(),
  getTranscriptWindow: jest.fn(),
}));

const { commitDebateScorecard, getDebateScorecard } = jest.requireMock(
  '@/lib/agents/shared/supabase-context',
) as {
  commitDebateScorecard: jest.Mock;
  getDebateScorecard: jest.Mock;
};

describe('commit_scorecard', () => {
  const room = 'room-123';
  const componentId = 'comp-abc';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00Z'));
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('merges the latest scorecard state when a conflict occurs before retrying', async () => {
    const stewardState = {
      componentId,
      topic: 'Test debate',
      claims: [
        { id: 'claim-1', side: 'AFF', speech: '1AC', quote: 'Initial claim', status: 'VERIFIED' },
        {
          id: 'claim-2',
          side: 'NEG',
          speech: '1NC',
          quote: 'New rebuttal',
          status: 'CHECKING',
        },
      ],
      timeline: [
        { id: 'evt-initial', timestamp: 1, text: 'Initial timeline', type: 'moderation' },
        { id: 'evt-steward', timestamp: 2, text: 'Steward update', type: 'argument' },
      ],
      status: { pendingVerifications: ['claim-2'], lastAction: 'Steward wrote update' },
    };

    const latestRecord = {
      state: debateScorecardStateSchema.parse({
        componentId,
        topic: 'Test debate',
        claims: [
          {
            id: 'claim-1',
            side: 'AFF',
            speech: '1AC',
            quote: 'Initial claim',
            status: 'CHECKING',
            scoreDelta: 1,
          },
          {
            id: 'claim-3',
            side: 'AFF',
            speech: '2AC',
            quote: 'Parallel update',
            status: 'CHECKING',
          },
        ],
        timeline: [
          { id: 'evt-initial', timestamp: 1, text: 'Initial timeline', type: 'moderation' },
          { id: 'evt-other', timestamp: 3, text: 'Other steward update', type: 'argument' },
        ],
        status: {
          pendingVerifications: ['claim-1', 'claim-3'],
          stewardRunId: 'other-run',
        },
      }),
      version: 2,
      lastUpdated: Date.now(),
    };

    getDebateScorecard.mockResolvedValue(latestRecord);
    commitDebateScorecard.mockImplementationOnce(() => {
      throw new Error('CONFLICT');
    });
    commitDebateScorecard.mockImplementationOnce(
      async (_room: string, _component: string, payload: { state: unknown; prevVersion?: number }) => ({
        state: payload.state,
        version: 3,
        lastUpdated: Date.now(),
      }),
    );

    await commit_scorecard.execute({
      room,
      componentId,
      stateJson: JSON.stringify(stewardState),
      prevVersion: 1,
      statusNote: 'Steward note',
    });

    expect(commitDebateScorecard).toHaveBeenCalledTimes(2);

    const [, , retryPayload] = commitDebateScorecard.mock.calls[1];
    expect(retryPayload.prevVersion).toBe(latestRecord.version);

    const retryState = debateScorecardStateSchema.parse(retryPayload.state);
    expect(retryState.claims.map((claim) => claim.id)).toEqual(['claim-1', 'claim-2', 'claim-3']);
    expect(retryState.timeline.map((evt) => evt.id)).toEqual(['evt-initial', 'evt-steward', 'evt-other']);
    expect(new Set(retryState.status.pendingVerifications)).toEqual(new Set(['claim-2', 'claim-3']));
    expect(retryState.status.lastAction).toBe('Steward wrote update');
  });
});
