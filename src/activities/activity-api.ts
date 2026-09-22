import { useRef, useState } from 'react';
import type { ActivityCommand } from '../../shared/activity';
export type Send = (command: ActivityCommand) => Promise<boolean>;
export async function post(path: string, body: unknown) {
  const response = await fetch(`/api/activity/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The room could not save that.');
  return result;
}
export function useActions(roomId: string, activityId: string, actor: string) {
  const [error, setError] = useState('');
  const attempts = useRef(new Map<string, string>());
  const send = async (command: ActivityCommand) => {
    const key = JSON.stringify(command),
      requestId = attempts.current.get(key) ?? crypto.randomUUID();
    attempts.current.set(key, requestId);
    setError('');
    try {
      await post('action', { roomId, activityId, actor, requestId, command });
      attempts.current.delete(key);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The room could not save that.');
      return false;
    }
  };
  return { send, error };
}
