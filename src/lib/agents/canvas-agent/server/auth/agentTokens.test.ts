import { mintAgentToken, verifyAgentToken } from './agentTokens';

const ORIGINAL_SECRET = process.env.CANVAS_AGENT_SECRET;

beforeAll(() => {
  process.env.CANVAS_AGENT_SECRET = 'unit-test-secret';
  delete process.env.CANVAS_AGENT_DEV_ALLOW_UNAUTH;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CANVAS_AGENT_SECRET;
  } else {
    process.env.CANVAS_AGENT_SECRET = ORIGINAL_SECRET;
  }
});

describe('agentTokens', () => {
  it('accepts valid token', () => {
    const token = mintAgentToken({ sessionId: 'sess', roomId: 'room', requestId: 'req', exp: Date.now() + 1000 });
    expect(verifyAgentToken(token, { sessionId: 'sess', roomId: 'room', requestId: 'req' })).toBe(true);
  });

  it('rejects invalid claims', () => {
    const token = mintAgentToken({ sessionId: 'sess', roomId: 'room', requestId: 'req', exp: Date.now() + 1000 });
    expect(verifyAgentToken(token, { sessionId: 'other', roomId: 'room' })).toBe(false);
  });

  it('allows dev bypass when enabled', () => {
    process.env.CANVAS_AGENT_DEV_ALLOW_UNAUTH = 'true';
    expect(verifyAgentToken(undefined, { sessionId: 'sess', roomId: 'room' })).toBe(true);
    delete process.env.CANVAS_AGENT_DEV_ALLOW_UNAUTH;
  });
});

