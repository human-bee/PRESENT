const CANVAS_USER_REGEX = /^canvas\s+user$/i;

function sanitizeDisplayName(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (CANVAS_USER_REGEX.test(trimmed)) return null;
  return trimmed;
}

function pickNameFromMetadataObject(candidate: unknown, depth = 0): string | null {
  if (!candidate || typeof candidate !== 'object' || depth > 3) return null;
  const obj = candidate as Record<string, unknown>;
  const keys = [
    'displayName',
    'display_name',
    'fullName',
    'full_name',
    'name',
    'userName',
    'username',
  ];

  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') {
      const sanitized = sanitizeDisplayName(value);
      if (sanitized) return sanitized;
    }
  }

  for (const value of Object.values(obj)) {
    if (typeof value === 'object') {
      const nested = pickNameFromMetadataObject(value, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

function extractNameFromMetadata(metadata?: string | null): string | null {
  if (!metadata || typeof metadata !== 'string') return null;
  try {
    const parsed = JSON.parse(metadata);
    const fromObject = pickNameFromMetadataObject(parsed);
    if (fromObject) return fromObject;
  } catch {}

  const regex = /"(displayName|display_name|fullName|full_name|name|userName|username)"\s*:\s*"([^"]+)"/i;
  const match = regex.exec(metadata);
  if (match?.[2]) {
    const sanitized = sanitizeDisplayName(match[2]);
    if (sanitized) return sanitized;
  }
  return null;
}

export function resolveParticipantDisplayName(participant: {
  name?: string | null;
  identity: string;
  metadata?: string | null;
}): string {
  const direct = sanitizeDisplayName(participant.name);
  if (direct) return direct;

  const fromMetadata = extractNameFromMetadata(participant.metadata);
  if (fromMetadata) return fromMetadata;

  const identity = participant.identity || '';
  if (!identity) return 'Participant';

  const base = identity.replace(/[-_]+[a-z0-9]{4,}$/i, '');
  const formatted = base.replace(/[-_]+/g, ' ').trim();

  return formatted || identity;
}

export function isDefaultCanvasUser(label?: string | null): boolean {
  if (!label) return false;
  return CANVAS_USER_REGEX.test(label.trim());
}

