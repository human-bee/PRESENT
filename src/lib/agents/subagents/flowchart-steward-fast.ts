import { getCerebrasClient, getModelForSteward, isFastStewardReady } from '../fast-steward-config';
import { getFlowchartDoc, getTranscriptWindow, commitFlowchartDoc, getContextDocuments, formatContextDocuments } from '../shared/supabase-context';
import { extractFirstToolCall, parseToolArgumentsResult } from './fast-steward-response';

const CEREBRAS_MODEL = getModelForSteward('FLOWCHART_STEWARD_FAST_MODEL');

export const flowchartStewardFastReady = isFastStewardReady();

const logFastMetric = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(`[StewardFAST][Metrics] ${label}`, { ts: new Date().toISOString(), ...payload });
  } catch { }
};

const FLOWCHART_STEWARD_FAST_INSTRUCTIONS = `
You are a fast flowchart editor. Each request includes the current flowchart doc and transcript.

Available operations:
- FULL UPDATE: Use commit_flowchart for complete rewrites
- ADD NODE: Insert "id[label]" or "id((label))" etc. into the doc
- ADD EDGE: Insert "A --> B" or "A --text--> B" connections
- REMOVE NODE: Delete the node definition and all edges referencing it
- RESTYLE: Change node shape, add styling classes, update labels

Mermaid syntax reference:
- graph TD/LR (top-down or left-right)
- Shapes: id[rectangle], id((circle)), id{diamond}, id>asymmetric], id([stadium])
- Edges: A --> B, A --- B, A -.-> B (dotted), A ==> B (thick)
- Edge labels: A -->|text| B
- Subgraphs: subgraph name ... end
- Styling: style id fill:#f9f,stroke:#333

Always call commit_flowchart with the complete updated doc after making changes.
`;

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'commit_flowchart',
      description: 'Commit the updated flowchart',
      parameters: {
        type: 'object',
        properties: {
          doc: {
            type: 'string',
            description: 'The complete updated mermaid flowchart document',
          },
          rationale: {
            type: 'string',
            description: 'Brief explanation of changes made',
          },
          format: {
            type: 'string',
            enum: ['mermaid'],
            description: 'Document format (always mermaid)',
          },
          prevVersion: {
            type: 'number',
            description: 'Version number of the doc being updated',
          },
        },
        required: ['doc', 'rationale', 'format', 'prevVersion'],
      },
    },
  },
];

type FlowchartResult = {
  status: 'ok' | 'no_change' | 'error';
  doc?: string;
  rationale?: string;
  version?: number;
  error?: string;
  _trace?: {
    provider: 'cerebras';
    model: string;
    providerSource: 'runtime_selected';
    providerPath: 'fast';
  };
};

const FLOWCHART_FAST_TRACE = {
  provider: 'cerebras' as const,
  model: CEREBRAS_MODEL,
  providerSource: 'runtime_selected' as const,
  providerPath: 'fast' as const,
};

export async function runFlowchartStewardFast(params: {
  room: string;
  docId: string;
  windowMs?: number;
}): Promise<FlowchartResult> {
  const { room, docId, windowMs = 60000 } = params;
  const overallStart = Date.now();

  if (!isFastStewardReady()) {
    return {
      status: 'error',
      error: 'FAST Flowchart steward unavailable (missing CEREBRAS_API_KEY)',
      _trace: FLOWCHART_FAST_TRACE,
    };
  }

  const [docRecord, transcriptWindow, contextDocs] = await Promise.all([
    getFlowchartDoc(room, docId),
    getTranscriptWindow(room, windowMs),
    getContextDocuments(room),
  ]);

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

  const currentVersion = docRecord?.version ?? 0;

  const messages = [
    { role: 'system' as const, content: FLOWCHART_STEWARD_FAST_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `Room: ${room}\nDoc Id: ${docId}\nCurrent version: ${currentVersion}\n\n--- Current flowchart doc ---\n${flowchartDocSection}\n${contextDocs.length > 0 ? `\n\n--- Context Documents ---\n${formatContextDocuments(contextDocs)}` : ''}\n\n--- Transcript window ---\n${formattedTranscript}\n\nTask: Update the flowchart holistically and call commit_flowchart with the full updated doc.`,
    },
  ];

  logFastMetric('agent.run.start', {
    room,
    docId,
    windowMs,
    model: CEREBRAS_MODEL,
    transcriptLines: transcript.length,
    currentVersion,
  });

  try {
    const client = getCerebrasClient();
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'commit_flowchart') {
      const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!argsResult.ok) {
        console.warn('[FlowchartStewardFast] Invalid tool arguments', {
          reason: argsResult.error,
          room,
          docId,
        });
        return { status: 'no_change' };
      }
      const args = argsResult.args;
      const doc = typeof args.doc === 'string' ? args.doc : '';
      if (!doc.trim()) {
        console.warn('[FlowchartStewardFast] Missing doc in commit_flowchart', { room, docId });
        return { status: 'no_change' };
      }

      const committed = await commitFlowchartDoc(room, docId, {
        doc,
        format: args.format === 'markdown' || args.format === 'streamdown' ? args.format : 'mermaid',
        prevVersion: typeof args.prevVersion === 'number' ? args.prevVersion : undefined,
        rationale: typeof args.rationale === 'string' ? args.rationale : undefined,
      });

      logFastMetric('agent.run.complete', {
        room,
        docId,
        newVersion: committed.version,
        durationMs: Date.now() - overallStart,
      });

      return {
        status: 'ok',
        doc,
        rationale: typeof args.rationale === 'string' ? args.rationale : undefined,
        version: committed.version,
        _trace: FLOWCHART_FAST_TRACE,
      };
    }

    logFastMetric('agent.run.no_change', { room, docId });
    return { status: 'no_change', _trace: FLOWCHART_FAST_TRACE };
  } catch (error) {
    console.error('[FlowchartStewardFast] error', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      _trace: FLOWCHART_FAST_TRACE,
    };
  }
}

export async function runFlowchartInstruction(params: {
  instruction: string;
  room: string;
  docId: string;
  currentDoc?: string;
  currentVersion?: number;
}): Promise<FlowchartResult> {
  const { instruction, room, docId, currentDoc, currentVersion = 0 } = params;

  if (!isFastStewardReady()) {
    return {
      status: 'error',
      error: 'FAST Flowchart steward unavailable (missing CEREBRAS_API_KEY)',
      _trace: FLOWCHART_FAST_TRACE,
    };
  }

  const docSection =
    currentDoc && currentDoc.trim().length > 0
      ? currentDoc
      : '(empty mermaid doc - start with "graph TD" or "graph LR")';

  const messages = [
    { role: 'system' as const, content: FLOWCHART_STEWARD_FAST_INSTRUCTIONS },
    {
      role: 'user' as const,
      content: `Room: ${room}\nDoc Id: ${docId}\nCurrent version: ${currentVersion}\n\n--- Current flowchart doc ---\n${docSection}\n\n--- Instruction ---\n${instruction}\n\nApply the instruction to the flowchart. Call commit_flowchart with the complete updated doc.`,
    },
  ];

  logFastMetric('instruction.run.start', {
    room,
    docId,
    instruction: instruction.slice(0, 100),
    model: CEREBRAS_MODEL,
  });

  try {
    const client = getCerebrasClient();
    const response = await client.chat.completions.create({
      model: CEREBRAS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
    });

    const toolCall = extractFirstToolCall(response);
    if (toolCall?.name === 'commit_flowchart') {
      const argsResult = parseToolArgumentsResult(toolCall.argumentsRaw);
      if (!argsResult.ok) {
        console.warn('[FlowchartInstruction] Invalid tool arguments', {
          reason: argsResult.error,
          room,
          docId,
        });
        return { status: 'no_change' };
      }
      const args = argsResult.args;
      const doc = typeof args.doc === 'string' ? args.doc : '';
      if (!doc.trim()) {
        console.warn('[FlowchartInstruction] Missing doc in commit_flowchart', { room, docId });
        return { status: 'no_change' };
      }

      const committed = await commitFlowchartDoc(room, docId, {
        doc,
        format: args.format === 'markdown' || args.format === 'streamdown' ? args.format : 'mermaid',
        prevVersion: typeof args.prevVersion === 'number' ? args.prevVersion : currentVersion,
        rationale: typeof args.rationale === 'string' ? args.rationale : undefined,
      });

      logFastMetric('instruction.run.complete', {
        room,
        docId,
        newVersion: committed.version,
      });

      return {
        status: 'ok',
        doc,
        rationale: typeof args.rationale === 'string' ? args.rationale : undefined,
        version: committed.version,
        _trace: FLOWCHART_FAST_TRACE,
      };
    }

    return { status: 'no_change', _trace: FLOWCHART_FAST_TRACE };
  } catch (error) {
    console.error('[FlowchartInstruction] error', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      _trace: FLOWCHART_FAST_TRACE,
    };
  }
}
