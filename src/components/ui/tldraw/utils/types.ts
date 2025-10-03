export type CanvasEventMap = Record<string, EventListener>;

export interface LiveKitBus {
  send(topic: string, payload: unknown): void;
  on(topic: string, handler: (payload: unknown) => void): (() => void) | undefined;
}
