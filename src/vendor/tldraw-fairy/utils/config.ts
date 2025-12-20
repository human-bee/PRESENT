export const FAIRY_WORKER =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FAIRY_WORKER_URL) || '/api/fairy';
