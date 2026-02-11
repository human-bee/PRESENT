export type StateEnvelope<T = unknown> = {
  id: string;
  kind: string;
  payload: T;
  version: number;
  ts: number;
  origin: string;
};
