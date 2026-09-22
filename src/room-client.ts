import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSync } from '@tldraw/sync';
import { atom, createUserId, defaultBindingUtils, defaultShapeUtils, UserRecordType, useValue, type Editor, type TLUser } from 'tldraw';
import type { Operation, Participant, RoomState } from '../shared/room';
import { recordsToRoom } from '../shared/tldraw-adapter';
import { getParticipantId } from './identity';
import { PresentWidgetShapeUtil } from './tldraw/PresentWidgetShapeUtil';
import { presentAssetStore } from './tldraw/asset-store';
export { getRoomId, getParticipantId } from './identity';

const shapeUtils = [...defaultShapeUtils, PresentWidgetShapeUtil];
const colors = ['#799857', '#ad81ba', '#c5954a', '#6899bc', '#c98598', '#a5a450'];

/** The room view is a projection of the synced tldraw records, never another store. */
export function useRoom(id: string, name: string) {
  const [selfId] = useState(getParticipantId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [operationError, setOperationError] = useState('');
  const color = colors[parseInt(selfId.slice(0, 8), 16) % colors.length];
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keep the sync identity atom stable; the effect below updates the display name.
  const currentUser = useMemo(() => atom<TLUser>('present-user', UserRecordType.create({ id: createUserId(selfId), name, color })), [selfId, color]);
  useEffect(() => { currentUser.update(user => ({ ...user, name })); }, [currentUser, name]);
  const users = useMemo(() => ({ currentUser }), [currentUser]);
  const sync = useSync({ uri: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/connect?room=${id}`, users, assets: presentAssetStore, shapeUtils, bindingUtils: defaultBindingUtils });
  const store = sync.store;
  const room = useValue('present-room', () => recordsToRoom(id, store?.allRecords() ?? []), [id, store]);
  const participants = useValue('present-people', (): Participant[] => {
    const peers = store?.query.records('instance_presence').get() ?? [];
    const byId = new Map<string, Participant>();
    byId.set(selfId, { id: selfId, name, color, kind: 'human' });
    for (const peer of peers) {
      const peerId = peer.userId.replace(/^user:/, '');
      byId.set(peerId, { id: peerId, name: peer.userName, color: peer.color, kind: 'human', cursor: peer.cursor ?? undefined });
    }
    return [...byId.values()];
  }, [store, selfId, name, color]);
  const selected = useValue('present-selection', () => editor?.getSelectedShapeIds().map(id => id.replace(/^shape:/, '')) ?? [], [editor]);
  const viewport = useValue('present-viewport', () => {
    const camera = editor?.getCamera();
    return camera ? { x: camera.x * camera.z, y: camera.y * camera.z, zoom: camera.z } : { x: 0, y: 0, zoom: 1 };
  }, [editor]);
  const act = useCallback(async (operation: Operation, requestId: string = crypto.randomUUID()): Promise<RoomState> => {
    const next = operation.type === 'put' && operation.pageId === undefined && editor ? { ...operation, pageId: editor.getCurrentPageId() } : operation;
    const response = await fetch(`/api/room/${id}/operation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: next, actor: selfId, requestId }),
    });
    const result = await response.json();
    if (!response.ok) { setOperationError(result.error || 'The room could not save this change.'); throw new Error(result.error); }
    setOperationError('');
    return result.room;
  }, [id, selfId, editor]);
  return { room, participants, selfId, editor, setEditor, sync, selected, viewport, act,
    connected: sync.status === 'synced-remote' && sync.connectionStatus === 'online',
    error: sync.error?.message || operationError };
}
