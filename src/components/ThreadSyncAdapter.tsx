'use client';
import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { useTamboThread, useTamboThreadList } from '@tambo-ai/react';
import { createLiveKitBus } from '../lib/livekit/livekit-bus';

export function ThreadSyncAdapter() {
  const room = useRoomContext();
  const bus = createLiveKitBus(room);
  const { thread, sendThreadMessage } = useTamboThread();
  const lastMsgRef = useRef<string>('');

  // Broadcast local messages
  useEffect(() => {
    if (!thread) return;
    const latest = thread.messages?.[thread.messages.length - 1];
    if (!latest || latest.id === lastMsgRef.current) return;
    lastMsgRef.current = latest.id;
    bus.send('thread_msg', { threadId: thread.id, message: latest });
  }, [thread, bus]);

  // Listen for remote messages
  useEffect(() => {
    const off = bus.on('thread_msg', async (msg: any) => {
      if (!msg?.message || msg.threadId === thread?.id) return;
      await sendThreadMessage(msg.message.content, { contextKey: room?.name });
    });
    return off;
  }, [bus, sendThreadMessage, thread?.id, room?.name]);

  return null;
}
