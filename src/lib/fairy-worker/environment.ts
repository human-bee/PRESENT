export interface FairyUserStub {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface FairyWorkerEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  FAIRY_MODEL?: string;
  IS_LOCAL?: string;
}
