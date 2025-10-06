import { useEffect } from 'react';
import { AUTO_CONNECT_DELAY_MS } from '../utils';
import type { LivekitRoomConnectorState } from './utils/lk-types';

interface UseLkAutoConnectParams {
  autoConnect: boolean;
  connect: () => Promise<void>;
  getState: () => LivekitRoomConnectorState;
}

export function useLkAutoConnect({
  autoConnect,
  connect,
  getState,
}: UseLkAutoConnectParams) {
  useEffect(() => {
    if (!autoConnect) {
      return;
    }

    const timer = setTimeout(() => {
      const latest = getState();
      if (latest.connectionState === 'disconnected') {
        void connect();
      }
    }, AUTO_CONNECT_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [autoConnect, connect, getState]);
}
