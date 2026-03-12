'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@tldraw/tldraw';
import { Room } from 'livekit-client';
import {
  Download,
  ImageIcon,
  Loader2,
  Palette,
  Pin,
  RefreshCw,
  Settings2,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { createLiveKitBus } from '../lib/livekit/livekit-bus';
import { Button } from '@/components/ui/shared/button';
import { Card } from '@/components/ui/shared/card';
import { useInfographicDrop, DRAG_MIME_TYPE } from '@/hooks/use-infographic-drop';
import { usePromotable } from '@/hooks/use-promotable';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';
import {
  DEFAULT_FAIRY_CONTEXT_PROFILE,
  FAIRY_CONTEXT_PROFILES,
  getFairyContextLimits,
  normalizeFairyContextProfile,
} from '@/lib/fairy-context/profiles';
import { formatFairyContextParts, type FairyContextPart } from '@/lib/fairy-context/format';
import { waitForMcpReady } from '@/lib/mcp-bridge';
import { buildMemoryPayload } from '@/lib/mcp/memory';
import { cn } from '@/lib/utils';
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_IMAGE_QUALITY_PRESET,
  DEFAULT_IMAGE_RESOLUTION_PRESET,
  IMAGE_ASPECT_RATIOS,
  IMAGE_MODEL_IDS,
  IMAGE_QUALITY_PRESETS,
  IMAGE_RESOLUTION_PRESETS,
  IMAGE_MODELS,
  clampAspectRatio,
  clampQualityPreset,
  clampResolutionPreset,
  getImageModelDefinition,
  type ImageAspectRatio,
  type ImageModelId,
  type ImageQualityPreset,
  type ImageResolutionPreset,
} from '@/lib/ai/image-models';

const DEFAULT_MEMORY_TOOL = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_TOOL;
const DEFAULT_MEMORY_COLLECTION = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_COLLECTION;
const DEFAULT_MEMORY_INDEX = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_INDEX;
const DEFAULT_MEMORY_NAMESPACE = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_NAMESPACE;
const DEFAULT_MEMORY_AUTO_SEND = process.env.NEXT_PUBLIC_INFOGRAPHIC_MEMORY_AUTO_SEND === 'true';
const MAX_MEMORY_SUMMARY_CHARS = 600;
const MAX_MEMORY_CONTENT_CHARS = 2000;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1280;

const infographicStyles = [
  {
    value: 'debate-board',
    label: 'Debate Board',
    accent: 'from-amber-200 via-orange-100 to-stone-50',
    prompt:
      'Editorial debate board, clear AFF versus NEG zoning, stat callouts, verdict framing, polished presentation slide clarity.',
  },
  {
    value: 'news-desk',
    label: 'News Desk',
    accent: 'from-slate-200 via-zinc-100 to-white',
    prompt:
      'Front-page newspaper energy, bold headline hierarchy, pull quotes, structured columns, serious editorial authority.',
  },
  {
    value: 'manifesto',
    label: 'Manifesto',
    accent: 'from-rose-200 via-orange-100 to-amber-50',
    prompt:
      'Poster manifesto composition, decisive typography, graphic sections, high contrast, persuasive visual rhetoric.',
  },
  {
    value: 'blueprint',
    label: 'Blueprint',
    accent: 'from-sky-200 via-cyan-100 to-white',
    prompt:
      'Analytical blueprint aesthetic, diagrammatic callouts, precise labeling, cool information design, lucid structure.',
  },
  {
    value: 'storybook',
    label: 'Storybook',
    accent: 'from-emerald-200 via-lime-100 to-teal-50',
    prompt:
      'Storybook explainer illustration, warm narrative framing, accessible sectioning, elegant infographic storytelling.',
  },
  {
    value: 'gallery',
    label: 'Gallery',
    accent: 'from-violet-200 via-fuchsia-100 to-rose-50',
    prompt:
      'Museum-wall infographic poster, refined composition, expressive negative space, premium art-book finish.',
  },
] as const;

const styleValues = infographicStyles.map((style) => style.value) as [
  (typeof infographicStyles)[number]['value'],
  ...(typeof infographicStyles)[number]['value'][],
];

const quickAngles = [
  'Focus on the strongest AFF vs NEG clash and show who won each front.',
  'Make it feel like a front-page debate briefing with crisp takeaways.',
  'Turn the round into a poster with timeline, verdict, and best evidence.',
] as const;

export const infographicWidgetSchema = z.object({
  direction: z.string().optional(),
  style: z.enum(styleValues).optional(),
  model: z.enum(IMAGE_MODEL_IDS).optional(),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
  resolution: z.enum(IMAGE_RESOLUTION_PRESETS).optional(),
  quality: z.enum(IMAGE_QUALITY_PRESETS).optional(),
  useGrounding: z.boolean().optional(),
  iterativeMode: z.boolean().optional(),
  contextProfile: z.string().optional(),
  memoryAutoSend: z.boolean().optional(),
  isShape: z.boolean().optional().default(true),
});

type InfographicWidgetProps = z.infer<typeof infographicWidgetSchema> & {
  room: Room | null;
  __custom_message_id?: string;
  messageId?: string;
  contextKey?: string;
};

type TranscriptEntry = {
  text?: string;
  participantName?: string | null;
  participantId?: string | null;
};

type ScorecardPlayer = {
  side?: string;
  label?: string;
  score?: number;
};

type ScorecardClaim = {
  side?: string;
  status?: string;
  verdict?: string;
  speech?: string;
  summary?: string;
  quote?: string;
  updatedAt?: number;
  createdAt?: number;
};

type ScorecardSource = {
  title?: string;
  url?: string;
  credibility?: string;
  type?: string;
};

type ScorecardState = {
  topic?: string;
  round?: string;
  players?: ScorecardPlayer[];
  claims?: ScorecardClaim[];
  sources?: ScorecardSource[];
  factCheckEnabled?: boolean;
  metrics?: {
    judgeLean?: string;
    roundScore?: number;
    evidenceQuality?: number;
  };
  rfd?: {
    summary?: string;
  };
  lastUpdated?: number;
};

type GeneratedInfographic = {
  id: string;
  url: string;
  timestamp: number;
  width: number;
  height: number;
  direction: string;
  style?: (typeof infographicStyles)[number]['value'];
  modelId: ImageModelId;
  modelLabel: string;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolutionPreset;
  quality: ImageQualityPreset;
  providerUsed?: string | null;
  fallbackReason?: string | null;
};

type ImageResponse = {
  b64_json: string;
  timings?: { inference?: number };
  providerUsed?: string | null;
  fallbackReason?: string | null;
  modelId: string;
  modelLabel: string;
  width?: number;
  height?: number;
};

function buildDataUrl(b64: string) {
  return `data:image/png;base64,${b64}`;
}

async function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof window === 'undefined') {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }

  return new Promise((resolve) => {
    const probe = new window.Image();
    probe.onload = () =>
      resolve({
        width: probe.naturalWidth || DEFAULT_WIDTH,
        height: probe.naturalHeight || DEFAULT_HEIGHT,
      });
    probe.onerror = () => resolve({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    probe.src = dataUrl;
  });
}

function formatImageGenerationError(message: string) {
  if (message.startsWith('BYOK_MISSING_KEY:')) {
    const provider = message.slice('BYOK_MISSING_KEY:'.length);
    return `Add a ${provider} key in Settings to use this infographic model.`;
  }
  if (message.startsWith('MISSING_PROVIDER_KEY:')) {
    const provider = message.slice('MISSING_PROVIDER_KEY:'.length);
    return `${provider} is not configured on this environment yet.`;
  }
  return message;
}

function formatProvider(providerUsed?: string | null) {
  if (!providerUsed) return null;
  const [provider] = providerUsed.split(':');
  if (!provider) return providerUsed;
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildScorecardContext(editor: unknown) {
  try {
    const maybeEditor = editor as {
      getCurrentPageShapes?: () => Array<{ type?: string; props?: { name?: string; state?: ScorecardState } }>;
    };
    const shapes = maybeEditor.getCurrentPageShapes?.() ?? [];
    const scorecards = shapes
      .filter((shape) => shape?.type === 'custom' && shape?.props?.name === 'DebateScorecard')
      .map((shape) => shape.props?.state ?? {})
      .filter(Boolean);

    if (!scorecards.length) return '';

    scorecards.sort((left, right) => Number(right.lastUpdated ?? 0) - Number(left.lastUpdated ?? 0));
    const state = scorecards[0];

    const topic = typeof state.topic === 'string' ? state.topic : '';
    const round = typeof state.round === 'string' ? state.round : '';
    const players = Array.isArray(state.players) ? state.players : [];
    const claims = Array.isArray(state.claims) ? state.claims : [];
    const sources = Array.isArray(state.sources) ? state.sources : [];
    const factCheckEnabled = state.factCheckEnabled === true;
    const metrics = state.metrics ?? {};
    const rfd = state.rfd ?? {};

    const formatPlayer = (side: string) => {
      const player = players.find((entry) => entry?.side === side) ?? {};
      const label = typeof player.label === 'string' ? player.label : side;
      const score = Number.isFinite(player.score) ? player.score : 0;
      return `${side}: ${label} (score ${score})`;
    };

    const pickClaims = (side: string) => {
      const sideClaims = claims.filter((entry) => entry?.side === side);
      sideClaims.sort(
        (left, right) =>
          Number(right.updatedAt ?? right.createdAt ?? 0) - Number(left.updatedAt ?? left.createdAt ?? 0),
      );
      return sideClaims.slice(0, 6).map((entry) => {
        const status = typeof entry.status === 'string' ? entry.status : '';
        const verdict = typeof entry.verdict === 'string' ? entry.verdict : '';
        const speech = typeof entry.speech === 'string' ? entry.speech : '';
        const summary = typeof entry.summary === 'string' ? entry.summary : '';
        const quote = typeof entry.quote === 'string' ? entry.quote : '';
        const text = summary || quote;
        const tag = [speech, status, verdict].filter(Boolean).join(' · ');
        return `- ${tag ? `[${tag}] ` : ''}${text}`.trim();
      });
    };

    const sourceLines = sources.slice(0, 8).map((entry) => {
      const title = typeof entry.title === 'string' ? entry.title : '';
      const url = typeof entry.url === 'string' ? entry.url : '';
      const credibility = typeof entry.credibility === 'string' ? entry.credibility : '';
      const type = typeof entry.type === 'string' ? entry.type : '';
      const meta = [credibility, type].filter(Boolean).join(' / ');
      return `- ${title || url}${meta ? ` (${meta})` : ''}${url ? ` — ${url}` : ''}`;
    });

    const judgeLean = typeof metrics.judgeLean === 'string' ? metrics.judgeLean : '';
    const roundScore = Number.isFinite(metrics.roundScore) ? metrics.roundScore : null;
    const evidenceQuality = Number.isFinite(metrics.evidenceQuality) ? metrics.evidenceQuality : null;
    const rfdSummary = typeof rfd.summary === 'string' ? rfd.summary : '';

    const sections: string[] = ['## Debate Scorecard Snapshot'];
    if (topic) sections.push(`Topic: ${topic}`);
    if (round) sections.push(`Round: ${round}`);
    sections.push(`Players:\n- ${formatPlayer('AFF')}\n- ${formatPlayer('NEG')}`);
    sections.push(`Fact-check enabled: ${factCheckEnabled ? 'yes' : 'no'}`);
    if (judgeLean || roundScore !== null || evidenceQuality !== null) {
      sections.push(
        `Metrics: judgeLean=${judgeLean || 'N/A'}, roundScore=${roundScore ?? 'N/A'}, evidenceQuality=${evidenceQuality ?? 'N/A'}`,
      );
    }

    const affClaims = pickClaims('AFF');
    const negClaims = pickClaims('NEG');
    if (affClaims.length || negClaims.length) {
      sections.push(`Top claims:\nAFF:\n${affClaims.join('\n') || '- (none)'}\n\nNEG:\n${negClaims.join('\n') || '- (none)'}`);
    }
    if (rfdSummary) {
      sections.push(`Judge / RFD summary:\n${rfdSummary}`);
    }
    if (sourceLines.length) {
      sections.push(`Sources referenced:\n${sourceLines.join('\n')}`);
    }

    return sections.join('\n\n');
  } catch {
    return '';
  }
}

export function InfographicWidget({
  room,
  isShape = false,
  __custom_message_id,
  messageId: propMessageId,
  contextKey,
  direction = '',
  style = 'debate-board',
  model = DEFAULT_IMAGE_MODEL_ID,
  aspectRatio = DEFAULT_IMAGE_ASPECT_RATIO,
  resolution = DEFAULT_IMAGE_RESOLUTION_PRESET,
  quality = DEFAULT_IMAGE_QUALITY_PRESET,
  useGrounding = true,
  iterativeMode = false,
  contextProfile = DEFAULT_FAIRY_CONTEXT_PROFILE,
  memoryAutoSend = DEFAULT_MEMORY_AUTO_SEND,
}: InfographicWidgetProps) {
  const widgetIdRef = useRef<string>(crypto.randomUUID());
  const messageId = propMessageId || __custom_message_id || widgetIdRef.current;
  const registryContext = contextKey || (isShape ? 'canvas' : 'default');

  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GeneratedInfographic[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [directionText, setDirectionText] = useState(direction);
  const [selectedStyle, setSelectedStyle] = useState<(typeof infographicStyles)[number]['value']>(style);
  const [selectedModel, setSelectedModel] = useState<ImageModelId>(model);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<ImageAspectRatio>(aspectRatio);
  const [selectedResolution, setSelectedResolution] = useState<ImageResolutionPreset>(resolution);
  const [selectedQuality, setSelectedQuality] = useState<ImageQualityPreset>(quality);
  const [groundingEnabled, setGroundingEnabled] = useState(useGrounding);
  const [seedMode, setSeedMode] = useState(iterativeMode);
  const [selectedContextProfile, setSelectedContextProfile] = useState(
    normalizeFairyContextProfile(contextProfile) ?? DEFAULT_FAIRY_CONTEXT_PROFILE,
  );
  const [contextBundleParts, setContextBundleParts] = useState<FairyContextPart[] | null>(null);
  const [memoryToolName, setMemoryToolName] = useState(DEFAULT_MEMORY_TOOL);
  const [memoryCollection, setMemoryCollection] = useState(DEFAULT_MEMORY_COLLECTION);
  const [memoryIndex, setMemoryIndex] = useState(DEFAULT_MEMORY_INDEX);
  const [memoryNamespace, setMemoryNamespace] = useState(DEFAULT_MEMORY_NAMESPACE);
  const [memoryAutoSendEnabled, setMemoryAutoSendEnabled] = useState(memoryAutoSend);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const lastPromptRef = useRef('');
  const lastMemorySentRef = useRef('');
  const promotedIdsRef = useRef(new Set<string>());
  const requestSequenceRef = useRef(0);
  const activeImageRef = useRef<GeneratedInfographic | null>(null);
  const directionRef = useRef(directionText);
  const styleRef = useRef(selectedStyle);
  const modelRef = useRef(selectedModel);
  const aspectRatioRef = useRef(selectedAspectRatio);
  const resolutionRef = useRef(selectedResolution);
  const qualityRef = useRef(selectedQuality);
  const groundingRef = useRef(groundingEnabled);
  const seedModeRef = useRef(seedMode);
  const contextProfileRef = useRef(selectedContextProfile);
  const memoryAutoSendRef = useRef(memoryAutoSendEnabled);

  const bus = useMemo(() => createLiveKitBus(room), [room]);
  const editor = useEditor();
  const { documents: contextDocuments, getPromptContext } = useCanvasContext();

  const memoryTarget = useMemo(
    () => ({
      collection: memoryCollection,
      index: memoryIndex,
      namespace: memoryNamespace,
    }),
    [memoryCollection, memoryIndex, memoryNamespace],
  );

  useEffect(() => {
    directionRef.current = directionText;
  }, [directionText]);

  useEffect(() => {
    styleRef.current = selectedStyle;
  }, [selectedStyle]);

  useEffect(() => {
    modelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    aspectRatioRef.current = selectedAspectRatio;
  }, [selectedAspectRatio]);

  useEffect(() => {
    resolutionRef.current = selectedResolution;
  }, [selectedResolution]);

  useEffect(() => {
    qualityRef.current = selectedQuality;
  }, [selectedQuality]);

  useEffect(() => {
    groundingRef.current = groundingEnabled;
  }, [groundingEnabled]);

  useEffect(() => {
    seedModeRef.current = seedMode;
  }, [seedMode]);

  useEffect(() => {
    contextProfileRef.current = selectedContextProfile;
  }, [selectedContextProfile]);

  useEffect(() => {
    memoryAutoSendRef.current = memoryAutoSendEnabled;
  }, [memoryAutoSendEnabled]);

  useEffect(() => {
    const definition = getImageModelDefinition(model);
    setDirectionText(direction);
    setSelectedStyle(style);
    setSelectedModel(model);
    setSelectedAspectRatio(clampAspectRatio(model, aspectRatio));
    setSelectedResolution(clampResolutionPreset(model, resolution));
    setSelectedQuality(clampQualityPreset(model, quality));
    setGroundingEnabled(definition.supportsGrounding ? useGrounding : false);
    setSeedMode(definition.supportsSeed ? iterativeMode : false);
    setSelectedContextProfile(
      normalizeFairyContextProfile(contextProfile) ?? DEFAULT_FAIRY_CONTEXT_PROFILE,
    );
    setMemoryAutoSendEnabled(memoryAutoSend);
  }, [aspectRatio, contextProfile, direction, iterativeMode, memoryAutoSend, model, quality, resolution, style, useGrounding]);

  useEffect(() => {
    if (!isShape) {
      const handleOpen = () => setIsOpen(true);
      window.addEventListener('present:open_infographic_widget', handleOpen);
      return () => window.removeEventListener('present:open_infographic_widget', handleOpen);
    }
  }, [isShape]);

  useEffect(() => {
    const off = bus.on('transcription', (data: TranscriptEntry) => {
      if (typeof data?.text !== 'string') return;
      setTranscripts((current) => [...current, data].slice(-20));
    });
    return off;
  }, [bus]);

  const selectedStyleData = useMemo(
    () => infographicStyles.find((entry) => entry.value === selectedStyle),
    [selectedStyle],
  );
  const selectedModelDefinition = useMemo(
    () => getImageModelDefinition(selectedModel),
    [selectedModel],
  );

  useEffect(() => {
    setSelectedAspectRatio((current) => clampAspectRatio(selectedModel, current));
    setSelectedResolution((current) => clampResolutionPreset(selectedModel, current));
    setSelectedQuality((current) => clampQualityPreset(selectedModel, current));
    if (!selectedModelDefinition.supportsGrounding) {
      setGroundingEnabled(false);
    }
    if (!selectedModelDefinition.supportsSeed) {
      setSeedMode(false);
    }
  }, [selectedModel, selectedModelDefinition.supportsGrounding, selectedModelDefinition.supportsSeed]);

  const activeImage = history[currentIndex] ?? null;
  activeImageRef.current = activeImage;

  const sendInfographicMemory = useCallback(
    async (image: GeneratedInfographic, promptText: string) => {
      const rawToolName = (memoryToolName || '').trim();
      const toolName = rawToolName.startsWith('mcp_') ? rawToolName.slice(4) : rawToolName;
      if (!toolName) return;

      const ready = await waitForMcpReady(200);
      if (!ready) return;

      const key = `${image.id}-${image.timestamp}-${promptText.length}`;
      if (lastMemorySentRef.current === key) return;

      const summary = promptText
        ? promptText.slice(0, MAX_MEMORY_SUMMARY_CHARS)
        : 'Infographic generated from conversation context.';
      const content = [
        `Infographic image id: ${image.id}`,
        `Widget messageId: ${messageId}`,
        promptText ? `Prompt:\n${promptText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const trimmedContent =
        content.length > MAX_MEMORY_CONTENT_CHARS
          ? `${content.slice(0, MAX_MEMORY_CONTENT_CHARS)}...`
          : content;

      const payload = buildMemoryPayload(
        toolName,
        {
          id: image.id,
          title: 'Infographic Summary',
          content: trimmedContent,
          summary,
          highlights: [],
          decisions: [],
          actionItems: [],
          tags: ['infographic', 'conversation'],
          contextProfile: contextProfileRef.current,
          contextKey: registryContext,
          messageId,
          lastUpdated: image.timestamp,
        },
        memoryTarget,
      );

      try {
        await (window as typeof window & { callMcpTool?: (tool: string, payload: unknown) => Promise<void> })
          .callMcpTool?.(toolName, payload);
        lastMemorySentRef.current = key;
      } catch (memoryError) {
        console.warn('[InfographicWidget] memory send failed', memoryError);
      }
    },
    [memoryTarget, memoryToolName, messageId, registryContext],
  );

  const getDropPlacement = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const editorRef = (window as typeof window & {
      __present?: {
        tldrawEditor?: {
          getCurrentPageShapes?: () => Array<{
            id: string;
            type?: string;
            props?: { customComponent?: string };
          }>;
          getShapePageBounds?: (shapeId: string) => { x: number; y: number; w: number; h: number } | null;
        };
      };
    }).__present?.tldrawEditor;

    const widgetShape =
      editorRef
        ?.getCurrentPageShapes?.()
        ?.find(
          (shape) =>
            shape.id === messageId ||
            (shape.type === 'custom' && String(shape.props?.customComponent || '') === messageId),
        ) ?? null;

    if (!widgetShape) return null;
    const bounds = editorRef?.getShapePageBounds?.(widgetShape.id);
    if (!bounds) return null;
    return {
      x: bounds.x + bounds.w + 48,
      y: bounds.y,
    };
  }, [messageId]);

  const promoteInfographic = useCallback((image: GeneratedInfographic | null, { force = false } = {}) => {
    if (!image || typeof window === 'undefined') return false;
    if (!force && promotedIdsRef.current.has(image.id)) return false;

    const placement = getDropPlacement();
    window.dispatchEvent(
      new CustomEvent('tldraw:promote_content', {
        detail: {
          id: image.id,
          type: 'image',
          label: 'Generated infographic',
          data: {
            url: image.url,
            width: image.width,
            height: image.height,
            title: 'Generated infographic',
            sourceComponentId: messageId,
            x: placement?.x,
            y: placement?.y,
          },
        },
      }),
    );

    promotedIdsRef.current.add(image.id);
    return true;
  }, [getDropPlacement, messageId]);

  const generateInfographic = useCallback(
    async (overrides?: {
      direction?: string;
      style?: (typeof infographicStyles)[number]['value'];
      model?: ImageModelId;
      aspectRatio?: ImageAspectRatio;
      resolution?: ImageResolutionPreset;
      quality?: ImageQualityPreset;
      useGrounding?: boolean;
      iterativeMode?: boolean;
      dropToCanvas?: boolean;
      forceDrop?: boolean;
    }): Promise<GeneratedInfographic | null> => {
      if (isGenerating) return null;

      const nextDirection = (overrides?.direction ?? directionRef.current ?? '').trim();
      const nextStyle = overrides?.style ?? styleRef.current;
      const nextModel = overrides?.model ?? modelRef.current;
      const nextAspectRatio = clampAspectRatio(nextModel, overrides?.aspectRatio ?? aspectRatioRef.current);
      const nextResolution = clampResolutionPreset(nextModel, overrides?.resolution ?? resolutionRef.current);
      const nextQuality = clampQualityPreset(nextModel, overrides?.quality ?? qualityRef.current);
      const nextGrounding =
        getImageModelDefinition(nextModel).supportsGrounding &&
        (overrides?.useGrounding ?? groundingRef.current);
      const nextSeedMode =
        getImageModelDefinition(nextModel).supportsSeed &&
        (overrides?.iterativeMode ?? seedModeRef.current);

      setIsGenerating(true);
      setError(null);
      if (!isShape) setIsOpen(true);

      const requestId = ++requestSequenceRef.current;

      try {
        const limits = getFairyContextLimits(contextProfileRef.current);
        const context = getPromptContext({
          transcriptLines: limits.TRANSCRIPT_LINES,
          maxDocumentLength: limits.MAX_DOCUMENT_LENGTH,
        });
        const recentLines = transcripts
          .slice(-limits.TRANSCRIPT_LINES)
          .map((entry) => `${entry.participantName || entry.participantId || 'Speaker'}: ${entry.text || ''}`)
          .join('\n');
        const scorecardContext = buildScorecardContext(editor);
        const bundleText = contextBundleParts
          ? formatFairyContextParts(contextBundleParts, limits.MAX_CONTEXT_CHARS)
          : '';

        if (
          !context?.trim() &&
          !recentLines.trim() &&
          !contextDocuments.length &&
          !scorecardContext &&
          !bundleText.trim()
        ) {
          throw new Error('No conversation context available yet. Start talking or add context documents.');
        }

        const prompt = [
          'Create a visually arresting infographic poster that summarizes the current debate or conversation.',
          'Prioritize strong hierarchy, legible callouts, AFF versus NEG separation when relevant, and faithful evidence-driven storytelling.',
          nextDirection ? `Focus direction: ${nextDirection}.` : 'Focus direction: make the key conflict immediately readable.',
          scorecardContext ? `\n## Debate Scorecard Snapshot\n${scorecardContext}\n` : '',
          recentLines ? `\n## Live Transcript\n${recentLines}\n` : '',
          context ? `\n## Additional Context\n${context}\n` : '',
          bundleText ? `\n## Context Bundle\n${bundleText}\n` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        lastPromptRef.current = prompt;

        const response = await fetch('/api/generateImages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            style: infographicStyles.find((entry) => entry.value === nextStyle)?.prompt,
            model: nextModel,
            aspectRatio: nextAspectRatio,
            resolution: nextResolution,
            quality: nextQuality,
            useGrounding: nextGrounding,
            iterativeMode: nextSeedMode,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || payload?.message || 'Infographic generation failed');
        }

        const data = payload as ImageResponse;
        const url = buildDataUrl(data.b64_json);
        const dimensions = await measureImage(url);

        if (requestId !== requestSequenceRef.current) {
          return null;
        }

        const generated: GeneratedInfographic = {
          id: `generated-infographic-${crypto.randomUUID()}`,
          url,
          timestamp: Date.now(),
          width: data.width ?? dimensions.width,
          height: data.height ?? dimensions.height,
          direction: nextDirection,
          style: nextStyle,
          modelId: nextModel,
          modelLabel: data.modelLabel,
          aspectRatio: nextAspectRatio,
          resolution: nextResolution,
          quality: nextQuality,
          providerUsed: data.providerUsed,
          fallbackReason: data.fallbackReason,
        };

        let nextIndex = 0;
        setHistory((current) => {
          const next = [...current.filter((entry) => entry.url !== generated.url), generated].slice(-8);
          nextIndex = next.length - 1;
          return next;
        });
        setCurrentIndex(nextIndex);

        if (memoryAutoSendRef.current) {
          void sendInfographicMemory(generated, lastPromptRef.current);
        }

        if (overrides?.dropToCanvas) {
          promoteInfographic(generated, { force: overrides.forceDrop });
        }

        return generated;
      } catch (generationError) {
        if (requestId === requestSequenceRef.current) {
          setError(
            generationError instanceof Error
              ? formatImageGenerationError(generationError.message)
              : 'Infographic generation failed',
          );
        }
        return null;
      } finally {
        if (requestId === requestSequenceRef.current) {
          setIsGenerating(false);
        }
      }
    },
    [contextBundleParts, contextDocuments.length, editor, getPromptContext, isGenerating, isShape, promoteInfographic, sendInfographicMemory, transcripts],
  );

  const handleAIUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      const nextModel =
        typeof patch.model === 'string' ? getImageModelDefinition(patch.model).id : modelRef.current;
      const nextModelDefinition = getImageModelDefinition(nextModel);

      if (typeof patch.direction === 'string') {
        setDirectionText(patch.direction);
      } else if (typeof patch.prompt === 'string') {
        setDirectionText(patch.prompt);
      } else if (typeof patch.instruction === 'string') {
        setDirectionText(patch.instruction);
      }

      if (typeof patch.style === 'string' && styleValues.includes(patch.style as (typeof styleValues)[number])) {
        setSelectedStyle(patch.style as (typeof infographicStyles)[number]['value']);
      }
      if (typeof patch.model === 'string') {
        setSelectedModel(nextModel);
      }
      if (typeof patch.aspectRatio === 'string') {
        setSelectedAspectRatio(clampAspectRatio(nextModel, patch.aspectRatio));
      }
      if (typeof patch.resolution === 'string') {
        setSelectedResolution(clampResolutionPreset(nextModel, patch.resolution));
      }
      if (typeof patch.quality === 'string') {
        setSelectedQuality(clampQualityPreset(nextModel, patch.quality));
      }
      if (typeof patch.useGrounding === 'boolean') {
        setGroundingEnabled(nextModelDefinition.supportsGrounding ? patch.useGrounding : false);
      }
      if (typeof patch.iterativeMode === 'boolean') {
        setSeedMode(nextModelDefinition.supportsSeed ? patch.iterativeMode : false);
      }
      if (typeof patch.contextProfile === 'string') {
        setSelectedContextProfile(
          normalizeFairyContextProfile(patch.contextProfile) ?? DEFAULT_FAIRY_CONTEXT_PROFILE,
        );
      }
      if (patch.contextBundle && typeof patch.contextBundle === 'object') {
        const parts = (patch.contextBundle as { parts?: FairyContextPart[] }).parts;
        if (Array.isArray(parts)) {
          setContextBundleParts(parts);
        }
      }
      if (typeof patch.memoryToolName === 'string') {
        setMemoryToolName(patch.memoryToolName);
      }
      if (typeof patch.memoryCollection === 'string') {
        setMemoryCollection(patch.memoryCollection);
      }
      if (typeof patch.memoryIndex === 'string') {
        setMemoryIndex(patch.memoryIndex);
      }
      if (typeof patch.memoryNamespace === 'string') {
        setMemoryNamespace(patch.memoryNamespace);
      }
      if (typeof patch.memoryAutoSend === 'boolean') {
        setMemoryAutoSendEnabled(patch.memoryAutoSend);
      }
      if (patch.clearHistory === true) {
        setHistory([]);
        setCurrentIndex(-1);
      }

      const wantsDrop = patch.dropLatest === true || patch.promoteLatest === true;
      const wantsGenerate =
        patch.generate === true ||
        patch.regenerate === true ||
        typeof patch.direction === 'string' ||
        typeof patch.prompt === 'string' ||
        typeof patch.instruction === 'string';

      if (wantsGenerate) {
        void generateInfographic({
          direction:
            typeof patch.direction === 'string'
              ? patch.direction
              : typeof patch.prompt === 'string'
                ? patch.prompt
                : typeof patch.instruction === 'string'
                  ? patch.instruction
                  : undefined,
          style:
            typeof patch.style === 'string' && styleValues.includes(patch.style as (typeof styleValues)[number])
              ? (patch.style as (typeof infographicStyles)[number]['value'])
              : undefined,
          model: typeof patch.model === 'string' ? nextModel : undefined,
          aspectRatio: typeof patch.aspectRatio === 'string' ? clampAspectRatio(nextModel, patch.aspectRatio) : undefined,
          resolution:
            typeof patch.resolution === 'string'
              ? clampResolutionPreset(nextModel, patch.resolution)
              : undefined,
          quality:
            typeof patch.quality === 'string'
              ? clampQualityPreset(nextModel, patch.quality)
              : undefined,
          useGrounding:
            typeof patch.useGrounding === 'boolean'
              ? nextModelDefinition.supportsGrounding
                ? patch.useGrounding
                : false
              : undefined,
          iterativeMode:
            typeof patch.iterativeMode === 'boolean'
              ? nextModelDefinition.supportsSeed
                ? patch.iterativeMode
                : false
              : undefined,
          dropToCanvas: wantsDrop,
          forceDrop: wantsDrop,
        });
      } else if (wantsDrop) {
        promoteInfographic(activeImageRef.current, { force: true });
      }
    },
    [generateInfographic, promoteInfographic],
  );

  useEffect(() => {
    const handleAgentAction = (event: Event) => {
      const envelope = (event as CustomEvent<{ actions?: Array<{ name?: string; params?: Record<string, unknown> }> }>).detail;
      if (!envelope?.actions) return;

      for (const action of envelope.actions) {
        if (action.name !== 'create_infographic') continue;

        const targetId =
          action.params?.widgetId ??
          action.params?.component_id ??
          action.params?.target_id ??
          action.params?.shape_id;

        if (targetId && targetId !== messageId) continue;
        handleAIUpdate({ ...(action.params || {}), generate: true });
        break;
      }
    };

    window.addEventListener('present:agent_actions', handleAgentAction);
    return () => window.removeEventListener('present:agent_actions', handleAgentAction);
  }, [handleAIUpdate, messageId]);

  const promotableItems = useMemo(
    () =>
      activeImage
        ? [
            {
              id: activeImage.id,
              type: 'image' as const,
              data: {
                url: activeImage.url,
                width: activeImage.width,
                height: activeImage.height,
                title: 'Generated infographic',
              },
              label: 'Generated infographic',
            },
          ]
        : [],
    [activeImage],
  );

  usePromotable(promotableItems, {
    messageId,
    componentType: 'InfographicWidget',
    contextKey: registryContext,
    props: {
      messageId,
      direction: directionText,
      style: selectedStyle,
      model: selectedModel,
      aspectRatio: selectedAspectRatio,
      resolution: selectedResolution,
      quality: selectedQuality,
      useGrounding: groundingEnabled,
      iterativeMode: seedMode,
      contextProfile: selectedContextProfile,
      memoryAutoSend: memoryAutoSendEnabled,
      currentImage: activeImage
        ? {
            id: activeImage.id,
            url: activeImage.url,
            width: activeImage.width,
            height: activeImage.height,
            modelLabel: activeImage.modelLabel,
          }
        : null,
    },
    updateCallback: handleAIUpdate,
  });

  useInfographicDrop({ editor, currentImage: activeImage, widgetId: messageId });

  const handleDownload = useCallback(() => {
    if (!activeImage) return;
    const link = document.createElement('a');
    link.href = activeImage.url;
    link.download = `infographic-${activeImage.timestamp}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeImage]);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLImageElement>) => {
      if (!activeImage) return;
      try {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(DRAG_MIME_TYPE.IGNORE, 'true');
        event.dataTransfer.setData(DRAG_MIME_TYPE.WIDGET, messageId);
        event.dataTransfer.setData(DRAG_MIME_TYPE.WIDTH, String(activeImage.width));
        event.dataTransfer.setData(DRAG_MIME_TYPE.HEIGHT, String(activeImage.height));
        event.dataTransfer.setData('text/plain', '');
        event.dataTransfer.setData('text/uri-list', '');
        event.dataTransfer.setData('text/html', '');
      } catch (dragError) {
        console.error('[InfographicWidget] drag start failed', dragError);
      }
    },
    [activeImage, messageId],
  );

  const renderContent = () => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#2d190d_0%,#140d08_48%,#0b0908_100%)] text-white">
      <div className="shrink-0 border-b border-white/10 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="rounded-2xl border border-white/12 bg-white/10 p-2">
                <ImageIcon className="h-4 w-4 text-white/88" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.26em] text-white/50">Context To Poster</p>
                <h3 className="text-sm font-semibold text-white">Infographic Atelier</h3>
              </div>
            </div>
            <p className="text-xs text-white/65">
              Turn live debate context into a board-ready visual summary.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <details className="relative">
              <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-white/12 bg-white/10 text-white/80 transition hover:bg-white/16">
                <Settings2 className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 top-12 z-20 w-[320px] rounded-[24px] border border-white/12 bg-[#160f09]/96 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/55">Behind The Scenes</p>
                    <p className="mt-1 text-xs text-white/68">
                      Tune output shape and context depth without bloating the front surface.
                    </p>
                  </div>

                  <label className="grid gap-1 text-xs text-white/74">
                    <span>Aspect ratio</span>
                    <select
                      value={selectedAspectRatio}
                      onChange={(event) => setSelectedAspectRatio(clampAspectRatio(selectedModel, event.target.value))}
                      className="rounded-2xl border border-white/12 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                    >
                      {selectedModelDefinition.supportedAspectRatios.map((ratio) => (
                        <option key={ratio} value={ratio} className="text-black">
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs text-white/74">
                      <span>Resolution</span>
                      <select
                        value={selectedResolution}
                        onChange={(event) => setSelectedResolution(clampResolutionPreset(selectedModel, event.target.value))}
                        className="rounded-2xl border border-white/12 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                      >
                        {selectedModelDefinition.supportedResolutionPresets.map((preset) => (
                          <option key={preset} value={preset} className="text-black">
                            {preset.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedModelDefinition.supportedQualities.length > 1 ? (
                      <label className="grid gap-1 text-xs text-white/74">
                        <span>Quality</span>
                        <select
                          value={selectedQuality}
                          onChange={(event) => setSelectedQuality(clampQualityPreset(selectedModel, event.target.value))}
                          className="rounded-2xl border border-white/12 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                          {selectedModelDefinition.supportedQualities.map((preset) => (
                            <option key={preset} value={preset} className="text-black">
                              {preset === 'auto' ? 'Auto' : preset.charAt(0).toUpperCase() + preset.slice(1)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <label className="grid gap-1 text-xs text-white/74">
                    <span>Context profile</span>
                    <select
                      value={selectedContextProfile}
                      onChange={(event) =>
                        setSelectedContextProfile(
                          normalizeFairyContextProfile(event.target.value) ?? DEFAULT_FAIRY_CONTEXT_PROFILE,
                        )
                      }
                      className="rounded-2xl border border-white/12 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                    >
                      {FAIRY_CONTEXT_PROFILES.map((profile) => (
                        <option key={profile} value={profile} className="text-black">
                          {profile}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid gap-2">
                    {selectedModelDefinition.supportsSeed ? (
                      <button
                        type="button"
                        onClick={() => setSeedMode((current) => !current)}
                        className={cn(
                          'inline-flex items-center justify-between rounded-2xl border px-3 py-2 text-xs transition',
                          seedMode
                            ? 'border-amber-200/60 bg-amber-100 text-amber-950'
                            : 'border-white/12 bg-black/20 text-white/74 hover:bg-black/30',
                        )}
                      >
                        <span>Consistent seed</span>
                        <span>{seedMode ? 'On' : 'Off'}</span>
                      </button>
                    ) : null}
                    {selectedModelDefinition.supportsGrounding ? (
                      <button
                        type="button"
                        onClick={() => setGroundingEnabled((current) => !current)}
                        className={cn(
                          'inline-flex items-center justify-between rounded-2xl border px-3 py-2 text-xs transition',
                          groundingEnabled
                            ? 'border-sky-200/60 bg-sky-100 text-sky-950'
                            : 'border-white/12 bg-black/20 text-white/74 hover:bg-black/30',
                        )}
                      >
                        <span>Search grounding</span>
                        <span>{groundingEnabled ? 'On' : 'Off'}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setMemoryAutoSendEnabled((current) => !current)}
                      className={cn(
                        'inline-flex items-center justify-between rounded-2xl border px-3 py-2 text-xs transition',
                        memoryAutoSendEnabled
                          ? 'border-emerald-200/60 bg-emerald-100 text-emerald-950'
                          : 'border-white/12 bg-black/20 text-white/74 hover:bg-black/30',
                      )}
                    >
                      <span>Send to memory</span>
                      <span>{memoryAutoSendEnabled ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </details>
            {!isShape ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full border border-white/12 bg-white/10 text-white/80 hover:bg-white/16"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="rounded-[26px] border border-white/12 bg-white/[0.06] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/52">Angle</p>
              <p className="mt-1 text-xs text-white/68">
                Say what the poster should privilege: clash, verdict, timeline, evidence, or mood.
              </p>
            </div>
            <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/66">
              Context-led
            </div>
          </div>
          <textarea
            value={directionText}
            onChange={(event) => setDirectionText(event.target.value)}
            placeholder="Emphasize the verdict, strongest evidence, and where AFF/NEG diverged..."
            className={cn(
              'mt-3 w-full resize-none rounded-[24px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/36',
              isShape ? 'h-24' : 'h-28',
            )}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {quickAngles.map((angle) => (
              <button
                key={angle}
                type="button"
                onClick={() => setDirectionText(angle)}
                className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-xs text-white/72 transition hover:bg-white/16"
              >
                {angle}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {IMAGE_MODELS.map((option) => {
            const active = selectedModel === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedModel(option.id)}
                className={cn(
                  'rounded-[24px] border px-3 py-3 text-left transition',
                  active
                    ? 'border-amber-200/60 bg-white text-stone-950 shadow-[0_12px_30px_rgba(0,0,0,0.12)]'
                    : 'border-white/12 bg-white/[0.08] text-white/78 hover:bg-white/[0.12]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.22em] opacity-70">{option.shortLabel}</span>
                  <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
                    {option.tier}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold">{option.label}</p>
                <p className={cn('mt-1 text-xs', active ? 'text-stone-700' : 'text-white/60')}>
                  {option.blurb}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          {infographicStyles.map((option) => {
            const active = selectedStyle === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedStyle(option.value)}
                className={cn(
                  'rounded-full border px-3 py-2 text-xs transition',
                  active
                    ? `border-white/20 bg-gradient-to-r ${option.accent} text-stone-950`
                    : 'border-white/12 bg-white/[0.08] text-white/72 hover:bg-white/[0.14]',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-white/76">
            <Sparkles className="h-3.5 w-3.5" />
            {selectedModelDefinition.label}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-white/76">
            <Palette className="h-3.5 w-3.5" />
            {selectedStyleData?.label || 'No tone'}
          </span>
          <span className="rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-white/76">
            {selectedAspectRatio} · {selectedResolution.toUpperCase()}
          </span>
          {groundingEnabled ? (
            <span className="rounded-full border border-sky-200/30 bg-sky-100/15 px-3 py-2 text-sky-50">
              Grounding on
            </span>
          ) : null}
          {activeImage?.fallbackReason ? (
            <span className="rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-white/68">
              {activeImage.fallbackReason}
            </span>
          ) : null}
          {error ? (
            <span className="rounded-full border border-rose-200/30 bg-rose-100/15 px-3 py-2 text-rose-100">
              {error}
            </span>
          ) : null}
        </div>

        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-white/12 bg-black/25',
            isShape ? 'basis-[280px]' : 'min-h-[360px]',
          )}
        >
          {isGenerating ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-amber-200/30 blur-md animate-pulse" />
                <Loader2 className="relative h-10 w-10 animate-spin text-amber-100" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Building the poster</p>
                <p className="mt-1 text-xs text-white/58">Reading the room, shaping hierarchy, rendering the board.</p>
              </div>
            </div>
          ) : activeImage ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{activeImage.modelLabel}</p>
                  <p className="truncate text-xs text-white/56">
                    {activeImage.direction || 'Context-first infographic summary'}
                  </p>
                </div>
                <div className="text-right text-[11px] text-white/52">
                  {formatProvider(activeImage.providerUsed) ? (
                    <p>Provider: {formatProvider(activeImage.providerUsed)}</p>
                  ) : null}
                  <p>{history.length} {history.length === 1 ? 'draft' : 'drafts'}</p>
                </div>
              </div>
              <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0b0908]">
                <img
                  src={activeImage.url}
                  alt="Generated infographic"
                  className="max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing"
                  draggable="true"
                  onDragStart={handleDragStart}
                />
              </div>
              {history.length > 1 ? (
                <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-white/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentIndex((current) => Math.max(0, current - 1))}
                    disabled={currentIndex === 0}
                    className="text-white/70 hover:bg-white/10"
                  >
                    Previous
                  </Button>
                  <span>
                    {currentIndex + 1} / {history.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentIndex((current) => Math.min(history.length - 1, current + 1))}
                    disabled={currentIndex === history.length - 1}
                    className="text-white/70 hover:bg-white/10"
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/12 bg-white/10">
                <Wand2 className="h-8 w-8 text-white/72" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Ready to generate</p>
                <p className="mt-1 max-w-[320px] text-xs text-white/58">
                  The widget will synthesize transcript, scorecard, context docs, and your angle into one clear poster.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            onClick={() => void generateInfographic()}
            disabled={isGenerating}
            className="w-full justify-center bg-white text-stone-950 hover:bg-white/92"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {activeImage ? 'Regenerate' : 'Generate'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => promoteInfographic(activeImage, { force: true })}
            disabled={!activeImage}
            className="w-full justify-center border border-white/12 bg-white/[0.08] text-white hover:bg-white/[0.14]"
          >
            <Pin className="mr-2 h-4 w-4" />
            Drop
          </Button>
          <Button
            variant="ghost"
            onClick={handleDownload}
            disabled={!activeImage}
            className="w-full justify-center border border-white/12 bg-white/[0.08] text-white hover:bg-white/[0.14]"
          >
            <Download className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );

  if (isShape) {
    return renderContent();
  }

  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-6 py-3 text-stone-950 shadow-[0_18px_40px_rgba(0,0,0,0.18)] hover:bg-stone-50"
        >
          <ImageIcon className="h-4 w-4" />
          Infographic
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[390px] max-w-[calc(100vw-2rem)] shadow-2xl">
      <Card className="h-[min(760px,calc(100vh-2rem))] overflow-hidden border-0 bg-transparent p-0">
        {renderContent()}
      </Card>
    </div>
  );
}
