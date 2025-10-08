import { useReducer, useRef, useEffect, useCallback } from 'react';
import {
  initialLivekitRoomConnectorState,
  livekitRoomConnectorReducer,
  type LivekitRoomConnectorAction,
  type LivekitRoomConnectorState,
} from './utils/lk-types';
import { mergeState as mergeStateAction, toggleMinimized as toggleMinimizedAction } from './utils/lk-actions';

interface UseLkStateResult {
  state: LivekitRoomConnectorState;
  dispatch: (action: LivekitRoomConnectorAction) => void;
  mergeState: (patch: Partial<LivekitRoomConnectorState>) => void;
  toggleMinimized: () => void;
  getState: () => LivekitRoomConnectorState;
}

export function useLkState(
  initialState: LivekitRoomConnectorState = initialLivekitRoomConnectorState,
): UseLkStateResult {
  const stateRef = useRef(initialState);
  const [state, dispatchBase] = useReducer(
    livekitRoomConnectorReducer,
    initialState,
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: LivekitRoomConnectorAction) => {
    dispatchBase(action);
  }, []);

  const mergeState = useCallback((patch: Partial<LivekitRoomConnectorState>) => {
    dispatchBase(mergeStateAction(patch));
  }, []);

  const toggleMinimized = useCallback(() => {
    dispatchBase(toggleMinimizedAction());
  }, []);

  const getState = useCallback(() => stateRef.current, []);

  return { state, dispatch, mergeState, toggleMinimized, getState };
}
