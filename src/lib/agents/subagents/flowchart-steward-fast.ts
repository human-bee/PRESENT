import { Agent, run } from '@openai/agents';
import type { Model, ModelRequest, ModelResponse, StreamEvent } from '@openai/agents-core';
import { OpenAIProvider, OpenAIChatCompletionsModel } from '@openai/agents-openai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { commit_flowchart } from './flowchart-steward';
import { getFlowchartDoc, getTranscriptWindow } from '../shared/supabase-context';

const logFastMetric = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(`[StewardFAST][Metrics] ${label}`, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_CEREBRAS_BASE_URL = 'https://api.cerebras.ai';

type FastProvider = 'groq' | 'cerebras';

const resolveFastProvider = (): FastProvider => {
  const preference =
    process.env.FLOWCHART_STEWARD_FAST_PROVIDER ??
    process.env.FLOWCHART_STEWARD_VARIANT ??
    process.env.AGENT_LLM_PROVIDER ??
    '';
  const normalized = preference.trim().toLowerCase();
  if (normalized === 'cerebras') return 'cerebras';
  return 'groq';
};

export const flowchartStewardFastProvider = resolveFastProvider();

const defaultModelByProvider: Record<FastProvider, string> = {
  groq: 'openai/gpt-oss-20b',
  cerebras: 'gpt-oss-120b',
};

type GroqProviderConfig = {
  kind: 'groq';
  provider: OpenAIProvider;
  apiKey?: string;
  baseURL: string;
};

type CerebrasCompatChatClient = {
  baseURL: string;
  chat: {
    completions: {
      create: (
        params: Record<string, any>,
        options?: Record<string, any>,
      ) => Promise<any> | AsyncIterable<any>;
    };
  };
};

type CerebrasProviderConfig = {
  kind: 'cerebras';
  client: CerebrasCompatChatClient;
  apiKey?: string;
  baseURL: string;
};

type ProviderConfig = GroqProviderConfig | CerebrasProviderConfig;

const createProviderConfig = (): ProviderConfig => {
  if (flowchartStewardFastProvider === 'cerebras') {
    const baseURL = process.env.CEREBRAS_API_BASE_URL || DEFAULT_CEREBRAS_BASE_URL;
    const apiKey = process.env.CEREBRAS_API_KEY;
    const client = new Cerebras({
      apiKey,
      baseURL,
      warmTCPConnection: false,
    });
    const compatClient = {
      baseURL,
      chat: {
        completions: {
          create: async (
            params: Record<string, any>,
            options: Record<string, any> | undefined,
          ) => {
            const sanitized: Record<string, any> = { ...params };
            // Cerebras doesn't yet support JSON schema response format; fall back to raw JSON.
            if (sanitized.response_format) {
              sanitized.response_format = null;
            }
            if (sanitized.parallel_tool_calls === undefined) {
              delete sanitized.parallel_tool_calls;
            }
            if (sanitized.store === undefined) {
              delete sanitized.store;
            }
            // Remove tool choice wrapper if null
            if (sanitized.tool_choice === undefined) {
              delete sanitized.tool_choice;
            }
            const requestStart = Date.now();
            try {
              logFastMetric('cerebras.request.start', {
                model: sanitized.model,
                toolCount: Array.isArray(sanitized.tools) ? sanitized.tools.length : 0,
                hasStream: Boolean(sanitized.stream),
              });
              const response = await (client.chat.completions.create as unknown as (
                params: Record<string, any>,
                options?: Record<string, any>,
              ) => Promise<any>)(sanitized, options);
              logFastMetric('cerebras.request.complete', {
                model: sanitized.model,
                durationMs: Date.now() - requestStart,
              });
              return response;
            } catch (error) {
              try {
                logFastMetric('cerebras.request.error', {
                  status: (error as { status?: number }).status,
                  body:
                    typeof (error as { response?: { data?: unknown } }).response?.data !== 'undefined'
                      ? (error as { response?: { data?: unknown } }).response?.data
                      : undefined,
                  fields: Object.keys(sanitized),
                  response_format: sanitized.response_format,
                  durationMs: Date.now() - requestStart,
                });
              } catch {}
              throw error;
            }
          },
        },
      },
    };
    return { kind: 'cerebras', client: compatClient, apiKey, baseURL };
  }
  const baseURL = process.env.GROQ_API_BASE_URL || DEFAULT_GROQ_BASE_URL;
  const apiKey = process.env.GROQ_API_KEY;
  const provider = new OpenAIProvider({
    apiKey: apiKey ?? process.env.OPENAI_API_KEY,
    baseURL,
    useResponses: true,
  });
  return { kind: 'groq', provider, apiKey, baseURL };
};

const providerConfig = createProviderConfig();

const resolvedModel =
  process.env.FLOWCHART_STEWARD_FAST_MODEL || defaultModelByProvider[flowchartStewardFastProvider];

const createLazyProviderModel = (provider: OpenAIProvider, modelName: string): Model => {
  let cachedModel: Promise<Model> | null = null;
  const ensureModel = () => {
    if (!cachedModel) {
      cachedModel = provider.getModel(modelName);
    }
    return cachedModel;
  };

  return {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      const model = await ensureModel();
      return model.getResponse(request);
    },
    async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
      const model = await ensureModel();
      for await (const event of model.getStreamedResponse(request)) {
        yield event;
      }
    },
  };
};

const buildModel = (): { model: Model; ready: boolean; baseURL: string } => {
  if (providerConfig.kind === 'cerebras') {
    const model = new OpenAIChatCompletionsModel(providerConfig.client as unknown as any, resolvedModel);
    return {
      model,
      ready: Boolean(providerConfig.apiKey),
      baseURL: providerConfig.baseURL,
    };
  }
  return {
    model: createLazyProviderModel(providerConfig.provider, resolvedModel),
    ready: Boolean(providerConfig.apiKey),
    baseURL: providerConfig.baseURL,
  };
};

const { model: lazyModel, ready: fastReady, baseURL: fastBaseUrl } = buildModel();

export const flowchartStewardFastReady = fastReady;

const FLOWCHART_STEWARD_FAST_INSTRUCTIONS =
  'You are the single writer for flowcharts. Each request already includes the full current flowchart document and recent transcript window. Never call tools to fetch additional context. Always call commit_flowchart exactly once per turn with a complete updated doc, format, rationale, and the provided prevVersion.';

export const flowchartStewardFast = new Agent({
  name: 'FlowchartStewardFAST',
  model: lazyModel,
  instructions: FLOWCHART_STEWARD_FAST_INSTRUCTIONS,
  tools: [commit_flowchart],
});

export async function runFlowchartStewardFast(params: { room: string; docId: string; windowMs?: number }) {
  const windowMs = params.windowMs ?? 60000;
  const overallStart = Date.now();
  const prefetchStart = Date.now();
  const [docRecord, transcriptWindow] = await Promise.all([
    getFlowchartDoc(params.room, params.docId),
    getTranscriptWindow(params.room, windowMs),
  ]);
  const prefetchDurationMs = Date.now() - prefetchStart;

  const transcript = Array.isArray(transcriptWindow?.transcript) ? transcriptWindow.transcript : [];
  const formattedTranscript =
    transcript.length === 0
      ? '(no recent transcript turns)'
      : transcript
          .slice()
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          .map((line) => {
            const ts = line.timestamp ? new Date(line.timestamp).toISOString() : 'unknown-ts';
            return `- [${ts}] ${line.participantId ?? 'anon'}: ${line.text ?? ''}`;
          })
          .join('\n');

  const flowchartDocSection =
    docRecord?.doc && docRecord.doc.trim().length > 0 ? docRecord.doc : '(empty mermaid doc)';

  const promptSections = [
    `Room: ${params.room}`,
    `Doc Id: ${params.docId}`,
    `Window (ms): ${windowMs}`,
    `Current version: ${docRecord?.version ?? 0}`,
    `Current format: ${docRecord?.format ?? 'mermaid'}`,
    '--- Current flowchart doc ---',
    flowchartDocSection,
    '--- Transcript window ---',
    formattedTranscript,
    'Task: Update the flowchart holistically and call commit_flowchart exactly once with the full updated doc, rationale, format, and prevVersion equal to the provided current version.',
  ];
  const prompt = promptSections.join('\n\n');

  logFastMetric('agent.run.start', {
    room: params.room,
    docId: params.docId,
    windowMs,
    provider: flowchartStewardFastProvider,
    model: resolvedModel,
    baseURL: fastBaseUrl,
    prefetchDurationMs,
    transcriptLines: transcript.length,
    currentVersion: docRecord?.version ?? 0,
  });

  const result = await run(flowchartStewardFast, prompt);

  const preview = typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 200) : null;
  logFastMetric('agent.run.complete', {
    room: params.room,
    docId: params.docId,
    windowMs,
    preview,
    durationMs: Date.now() - overallStart,
  });

  return result.finalOutput;
}
