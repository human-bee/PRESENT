import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Operation } from '../../shared/room';

export type WidgetRuntime = {
  roomId: string;
  selfId: string;
  act: (operation: Operation, requestId?: string) => unknown;
  onError?: (message: string) => void;
};
const RuntimeContext = createContext<WidgetRuntime | null>(null);

export function WidgetRuntimeProvider({ children, roomId, selfId, act, onError }: WidgetRuntime & { children: ReactNode }) {
  const runtime = useMemo(() => ({ roomId, selfId, act, onError }), [roomId, selfId, act, onError]);
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useWidgetRuntime(): WidgetRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('PRESENT widgets need their room runtime.');
  return runtime;
}
