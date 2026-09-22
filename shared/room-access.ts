export type RoomRole = 'owner' | 'editor' | 'viewer';
export type RoomPermission = 'read' | 'write' | 'tools' | 'asset:read' | 'asset:write' | 'invite' | 'revoke';
export type RoomGrant = { roomId: string; userId: string; role: RoomRole; expiresAt: number };
export type RoomInvite = { id: string; token: string; expiresAt: number; role: 'editor' | 'viewer'; maxUses: number };
export const roleAllows = (role: RoomRole, permission: RoomPermission): boolean => {
  if (permission === 'read' || permission === 'asset:read') return ['owner', 'editor', 'viewer'].includes(role);
  if (permission === 'write' || permission === 'tools' || permission === 'asset:write') return role === 'owner' || role === 'editor';
  if (permission === 'invite' || permission === 'revoke') return role === 'owner';
  return false;
};
