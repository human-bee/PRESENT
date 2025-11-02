import crypto from 'node:crypto';

type Claims = {
  sessionId: string;
  roomId: string;
  requestId?: string;
  exp: number;
};

const getSecret = () => process.env.CANVAS_AGENT_SECRET;

const encodeClaims = (claims: Claims) => Buffer.from(JSON.stringify(claims)).toString('base64url');

export const mintAgentToken = (claims: Claims): string => {
  const secret = getSecret();
  if (!secret) {
    throw new Error('CANVAS_AGENT_SECRET is required to mint tokens');
  }
  const payload = encodeClaims(claims);
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const verifyAgentToken = (token: string | undefined, expect: Partial<Claims>): boolean => {
  if (process.env.CANVAS_AGENT_DEV_ALLOW_UNAUTH === 'true') {
    return true;
  }
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const secret = getSecret();
  if (!secret) return false;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature.length !== expectedSignature.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return false;
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claims;
  } catch {
    return false;
  }
  if (typeof claims.exp !== 'number' || Date.now() > claims.exp) return false;
  if (expect.sessionId && claims.sessionId !== expect.sessionId) return false;
  if (expect.roomId && claims.roomId !== expect.roomId) return false;
  if (expect.requestId && claims.requestId !== expect.requestId) return false;
  return true;
};

