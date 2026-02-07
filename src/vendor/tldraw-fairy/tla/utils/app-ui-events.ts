export type TLAppUiHandler = (eventName: string, payload?: Record<string, unknown>) => void;

export function useTldrawAppUiEvents(): TLAppUiHandler {
  return () => {
    // noop for PRESENT
  };
}
