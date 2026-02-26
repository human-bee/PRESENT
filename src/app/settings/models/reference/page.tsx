import Link from 'next/link';

type Row = {
  path: string;
  type: string;
  rangeOrOptions: string;
  notes: string;
};

const modelRows: Row[] = [
  {
    path: 'models.canvasSteward',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Canvas steward primary model.',
  },
  {
    path: 'models.voiceRealtime',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Realtime voice conversation model.',
  },
  {
    path: 'models.voiceRealtimePrimary',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Primary realtime model (adaptive full-profile target).',
  },
  {
    path: 'models.voiceRealtimeSecondary',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Secondary realtime model (adaptive lite-profile target).',
  },
  {
    path: 'models.voiceRouter',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Manual voice routing model.',
  },
  {
    path: 'models.voiceStt',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Voice transcription model selector.',
  },
  {
    path: 'models.searchModel',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Search and fact-check model selector.',
  },
  {
    path: 'models.fastDefault',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Global default for fast stewards.',
  },
  {
    path: 'models.fastBySteward.<steward>',
    type: 'record<string,string>',
    rangeOrOptions: 'steward key -> model id',
    notes: 'Per-steward fast model overrides (flowchart, summary, debate, crowd_pulse, linear, youtube).',
  },
];

const knobRows: Row[] = [
  {
    path: 'knobs.canvas.preset',
    type: 'enum',
    rangeOrOptions: 'creative | precise',
    notes: 'Canvas prompt behavior preset.',
  },
  {
    path: 'knobs.canvas.temperature',
    type: 'number',
    rangeOrOptions: '0..2',
    notes: 'Canvas sampling temperature.',
  },
  {
    path: 'knobs.canvas.topP',
    type: 'number',
    rangeOrOptions: '0..1',
    notes: 'Canvas nucleus sampling.',
  },
  {
    path: 'knobs.canvas.maxOutputTokens',
    type: 'int',
    rangeOrOptions: '1..32000',
    notes: 'Canvas max output tokens.',
  },
  {
    path: 'knobs.canvas.ttfbSloMs',
    type: 'int',
    rangeOrOptions: '1..10000',
    notes: 'Canvas TTFB target.',
  },
  {
    path: 'knobs.canvas.screenshotTimeoutMs',
    type: 'int',
    rangeOrOptions: '250..30000',
    notes: 'Canvas screenshot timeout.',
  },
  {
    path: 'knobs.canvas.screenshotRetries',
    type: 'int',
    rangeOrOptions: '0..8',
    notes: 'Canvas screenshot retries.',
  },
  {
    path: 'knobs.canvas.screenshotRetryDelayMs',
    type: 'int',
    rangeOrOptions: '10..10000',
    notes: 'Canvas screenshot retry delay.',
  },
  {
    path: 'knobs.canvas.followupMaxDepth',
    type: 'int',
    rangeOrOptions: '0..12',
    notes: 'Canvas follow-up max depth.',
  },
  {
    path: 'knobs.canvas.lowActionThreshold',
    type: 'int',
    rangeOrOptions: '0..40',
    notes: 'Canvas low-action threshold.',
  },
  {
    path: 'knobs.canvas.promptMaxChars',
    type: 'int',
    rangeOrOptions: '2000..500000',
    notes: 'Canvas prompt character cap.',
  },
  {
    path: 'knobs.canvas.transcriptWindowMs',
    type: 'int',
    rangeOrOptions: '1000..3600000',
    notes: 'Canvas transcript window.',
  },
  {
    path: 'knobs.voice.transcriptionEnabled',
    type: 'boolean',
    rangeOrOptions: 'true | false',
    notes: 'Enable/disable voice transcription.',
  },
  {
    path: 'knobs.voice.sttModel',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Knob alias for STT model.',
  },
  {
    path: 'knobs.voice.realtimeModel',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Knob alias for realtime model.',
  },
  {
    path: 'knobs.voice.realtimeModelStrategy',
    type: 'enum',
    rangeOrOptions: 'fixed | adaptive_profile',
    notes: 'Realtime model selection strategy.',
  },
  {
    path: 'knobs.voice.routerModel',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Knob alias for router model.',
  },
  {
    path: 'knobs.voice.turnDetection',
    type: 'enum',
    rangeOrOptions: 'none | server_vad | semantic_vad',
    notes: 'Voice turn-detection strategy.',
  },
  {
    path: 'knobs.voice.inputNoiseReduction',
    type: 'enum',
    rangeOrOptions: 'none | near_field | far_field',
    notes: 'Voice input noise profile.',
  },
  {
    path: 'knobs.voice.replyTimeoutMs',
    type: 'int',
    rangeOrOptions: '100..120000',
    notes: 'Voice reply timeout.',
  },
  {
    path: 'knobs.voice.interruptTimeoutMs',
    type: 'int',
    rangeOrOptions: '50..120000',
    notes: 'Voice interrupt timeout.',
  },
  {
    path: 'knobs.voice.transcriptionReadyTimeoutMs',
    type: 'int',
    rangeOrOptions: '100..120000',
    notes: 'Voice transcription-ready timeout.',
  },
  {
    path: 'knobs.conductor.roomConcurrency',
    type: 'int',
    rangeOrOptions: '1..256',
    notes: 'Conductor room concurrency.',
  },
  {
    path: 'knobs.conductor.taskLeaseTtlMs',
    type: 'int',
    rangeOrOptions: '500..300000',
    notes: 'Queue task lease TTL.',
  },
  {
    path: 'knobs.conductor.taskIdlePollMs',
    type: 'int',
    rangeOrOptions: '10..60000',
    notes: 'Conductor idle poll interval.',
  },
  {
    path: 'knobs.conductor.taskIdlePollMaxMs',
    type: 'int',
    rangeOrOptions: '10..120000',
    notes: 'Conductor max idle poll interval.',
  },
  {
    path: 'knobs.conductor.taskMaxRetryAttempts',
    type: 'int',
    rangeOrOptions: '1..30',
    notes: 'Queue retry attempts.',
  },
  {
    path: 'knobs.conductor.taskRetryBaseDelayMs',
    type: 'int',
    rangeOrOptions: '10..120000',
    notes: 'Queue retry base delay.',
  },
  {
    path: 'knobs.conductor.taskRetryMaxDelayMs',
    type: 'int',
    rangeOrOptions: '10..300000',
    notes: 'Queue retry max delay.',
  },
  {
    path: 'knobs.conductor.taskRetryJitterRatio',
    type: 'number',
    rangeOrOptions: '0..0.99',
    notes: 'Queue retry jitter ratio.',
  },
  {
    path: 'knobs.search.model',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Knob alias for search model.',
  },
  {
    path: 'knobs.search.cacheTtlSec',
    type: 'int',
    rangeOrOptions: '1..86400',
    notes: 'Search response cache TTL.',
  },
  {
    path: 'knobs.search.maxResults',
    type: 'int',
    rangeOrOptions: '1..6',
    notes: 'Search max results.',
  },
  {
    path: 'knobs.search.includeAnswer',
    type: 'boolean',
    rangeOrOptions: 'true | false',
    notes: 'Include answer summary.',
  },
  {
    path: 'knobs.search.costPerMinuteLimit',
    type: 'int',
    rangeOrOptions: '1..10000',
    notes: 'Search budget limiter.',
  },
  {
    path: 'knobs.fastStewards.defaultModel',
    type: 'string',
    rangeOrOptions: 'provider/model id',
    notes: 'Alias for fast default model.',
  },
  {
    path: 'knobs.fastStewards.bySteward.<steward>',
    type: 'record<string,string>',
    rangeOrOptions: 'steward key -> model id',
    notes: 'Alias for per-steward fast models.',
  },
];

const coverageRows = [
  {
    runtime: 'Realtime voice conversation',
    coverage: 'partial (transport/model env-only)',
    keys:
      'models.voiceRealtime, models.voiceRealtimePrimary, models.voiceRealtimeSecondary, knobs.voice.*, VOICE_AGENT_MODEL_TRANSPORT env, VOICE_AGENT_RESPONSES_MODEL env',
  },
  {
    runtime: 'Voice transcription',
    coverage: 'covered',
    keys: 'models.voiceStt, knobs.voice.transcriptionEnabled',
  },
  {
    runtime: 'Voice manual router',
    coverage: 'covered',
    keys: 'models.voiceRouter',
  },
  {
    runtime: 'Canvas steward',
    coverage: 'covered',
    keys: 'models.canvasSteward, knobs.canvas.*',
  },
  {
    runtime: 'Search / fact-check',
    coverage: 'covered',
    keys: 'models.searchModel, knobs.search.*',
  },
  {
    runtime: 'Fast stewards',
    coverage: 'covered',
    keys: 'models.fastDefault, models.fastBySteward.*',
  },
  {
    runtime: 'Conductor queue behavior',
    coverage: 'covered',
    keys: 'knobs.conductor.*',
  },
  {
    runtime: 'Fairy router fast model',
    coverage: 'not yet in control plane',
    keys: 'FAIRY_ROUTER_FAST_MODEL env',
  },
  {
    runtime: 'Fairy worker model',
    coverage: 'not yet in control plane',
    keys: 'FAIRY_MODEL env',
  },
  {
    runtime: '/api/transcribe model',
    coverage: 'not yet in control plane',
    keys: 'hardcoded whisper-1',
  },
  {
    runtime: 'Infographic image generation model path',
    coverage: 'not yet in control plane',
    keys: 'request model + Gemini/Together fallback in route',
  },
];

const Table = ({ rows }: { rows: Row[] }) => (
  <div className="overflow-auto rounded-lg border border-gray-200">
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50 text-left">
        <tr>
          <th className="px-3 py-2 font-semibold text-gray-700">Path</th>
          <th className="px-3 py-2 font-semibold text-gray-700">Type</th>
          <th className="px-3 py-2 font-semibold text-gray-700">Range / Options</th>
          <th className="px-3 py-2 font-semibold text-gray-700">Notes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 bg-white">
        {rows.map((row) => (
          <tr key={row.path}>
            <td className="px-3 py-2 font-mono text-xs text-gray-800">{row.path}</td>
            <td className="px-3 py-2 text-gray-700">{row.type}</td>
            <td className="px-3 py-2 text-gray-700">{row.rangeOrOptions}</td>
            <td className="px-3 py-2 text-gray-700">{row.notes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function ModelControlsReferencePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Model Controls Reference</h1>
            <p className="mt-1 text-sm text-gray-600">
              Canonical field-level reference for model and knob keys accepted by the control plane.
            </p>
          </div>
          <Link className="text-sm text-blue-700 underline" href="/settings/models">
            Back to Model Controls
          </Link>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold">How Model Names Work</h2>
          <p className="mt-2 text-sm text-gray-700">
            Model selectors are free-form strings validated for shape and length only. There is no global allowlist in this
            app; valid IDs depend on each provider account and runtime SDK support.
          </p>
          <p className="mt-2 text-sm text-gray-700">
            Fast steward model strings are normalized by fast-steward config (for example alias normalization for llama/qwen
            variants).
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Model Selectors</h2>
          <p className="mt-1 text-sm text-gray-600">Paths under <code>config.models</code>.</p>
          <div className="mt-3">
            <Table rows={modelRows} />
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Operational Knobs</h2>
          <p className="mt-1 text-sm text-gray-600">Paths under <code>config.knobs</code> with enforced bounds.</p>
          <div className="mt-3">
            <Table rows={knobRows} />
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Runtime Coverage</h2>
          <div className="overflow-auto rounded-lg border border-gray-200 mt-3">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold text-gray-700">Runtime / Instance</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Coverage</th>
                  <th className="px-3 py-2 font-semibold text-gray-700">Key Path / Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {coverageRows.map((row) => (
                  <tr key={row.runtime}>
                    <td className="px-3 py-2 text-gray-800">{row.runtime}</td>
                    <td className="px-3 py-2 text-gray-700">{row.coverage}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{row.keys}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
