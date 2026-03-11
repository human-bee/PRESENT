import { presenceMemberSchema, type PresenceMember } from '@present/contracts';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { readResetCollection, writeResetCollection } from './persistence';

export function listPresenceMembers(workspaceSessionId?: string) {
  return readResetCollection('presence')
    .filter((member) => !workspaceSessionId || member.workspaceSessionId === workspaceSessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function upsertPresenceMember(input: {
  workspaceSessionId: string;
  identity: string;
  displayName: string;
  state: PresenceMember['state'];
  media?: PresenceMember['media'];
  metadata?: Record<string, unknown>;
}) {
  const members = readResetCollection('presence');
  const now = new Date().toISOString();
  const existing = members.find(
    (member) => member.workspaceSessionId === input.workspaceSessionId && member.identity === input.identity,
  );

  const next = presenceMemberSchema.parse({
    id: existing?.id ?? createResetId(RESET_ID_PREFIXES.presence),
    workspaceSessionId: input.workspaceSessionId,
    identity: input.identity,
    displayName: input.displayName,
    state: input.state,
    media: input.media ?? existing?.media ?? { audio: false, video: false, screen: false },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  });

  writeResetCollection(
    'presence',
    [...members.filter((member) => member.id !== next.id), next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );

  return next;
}

export function setPresenceMemberState(
  workspaceSessionId: string,
  identity: string,
  state: PresenceMember['state'],
) {
  const current = listPresenceMembers(workspaceSessionId).find((member) => member.identity === identity);
  if (!current) return null;

  return upsertPresenceMember({
    workspaceSessionId,
    identity,
    displayName: current.displayName,
    state,
    media: current.media,
    metadata: current.metadata,
  });
}
