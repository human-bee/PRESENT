'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import {
  Check,
  Download,
  Loader2,
  Mic,
  MicOff,
  Palette,
  Pin,
  RefreshCw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/shared/button';
import { WidgetFrame } from '@/components/ui/productivity/widget-frame';
import { usePromotable } from '@/hooks/use-promotable';
import { useAllTranscripts } from '@/lib/stores/transcript-store';
import { cn } from '@/lib/utils';

const imageStyles = [
  {
    value: 'minimal',
    label: 'Minimal',
    accent: 'from-stone-200 via-zinc-50 to-white',
    prompt:
      'Minimal composition, confident negative space, crisp forms, restrained palette, elegant balance.',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    accent: 'from-amber-200 via-orange-100 to-rose-100',
    prompt:
      'Cinematic frame, dramatic lighting, rich atmosphere, precise composition, filmic color separation.',
  },
  {
    value: 'retro',
    label: 'Retro',
    accent: 'from-orange-200 via-yellow-100 to-amber-50',
    prompt:
      'Retro print energy, nostalgic palette, tactile grain, poster-like composition, playful restraint.',
  },
  {
    value: 'watercolor',
    label: 'Watercolor',
    accent: 'from-sky-200 via-cyan-100 to-white',
    prompt:
      'Watercolor brush bloom, soft edges, paper texture, luminous washes, painterly flow.',
  },
  {
    value: 'fantasy',
    label: 'Fantasy',
    accent: 'from-emerald-200 via-lime-100 to-teal-50',
    prompt:
      'Fantasy illustration, enchanted atmosphere, intricate detail, storybook lighting, imaginative worldbuilding.',
  },
  {
    value: 'moody',
    label: 'Moody',
    accent: 'from-slate-400 via-zinc-300 to-stone-200',
    prompt:
      'Moody atmosphere, shadow-forward lighting, restrained color, tactile texture, emotionally charged framing.',
  },
  {
    value: 'vibrant',
    label: 'Vibrant',
    accent: 'from-pink-200 via-orange-100 to-yellow-100',
    prompt:
      'Vibrant palette, energetic contrast, punchy graphic clarity, luminous highlights, expressive color.',
  },
  {
    value: 'pop-art',
    label: 'Pop Art',
    accent: 'from-yellow-200 via-red-100 to-pink-100',
    prompt:
      'Pop art punch, thick outlines, playful visual rhythm, bold primary color attitude, graphic confidence.',
  },
  {
    value: 'cyberpunk',
    label: 'Cyberpunk',
    accent: 'from-cyan-200 via-sky-100 to-fuchsia-100',
    prompt:
      'Cyberpunk nocturne, neon glow, dense city atmosphere, reflective surfaces, futuristic tension.',
  },
  {
    value: 'surreal',
    label: 'Surreal',
    accent: 'from-violet-200 via-fuchsia-100 to-rose-100',
    prompt:
      'Surreal imagery, dream logic, impossible juxtaposition, uncanny stillness, poetic visual symbolism.',
  },
  {
    value: 'art-deco',
    label: 'Art Deco',
    accent: 'from-yellow-200 via-amber-100 to-stone-100',
    prompt:
      'Art Deco elegance, geometric ornament, luxury materials, symmetrical glamour, polished vintage drama.',
  },
  {
    value: 'graffiti',
    label: 'Graffiti',
    accent: 'from-lime-200 via-emerald-100 to-cyan-100',
    prompt:
      'Graffiti surface energy, spray texture, urban boldness, layered marks, street-level momentum.',
  },
] as const;

const styleValues = imageStyles.map((style) => style.value) as [
  (typeof imageStyles)[number]['value'],
  ...(typeof imageStyles)[number]['value'][],
];

const quickStarts = [
  'An editorial still life of analog tools arranged like a future ritual',
  'A product concept render floating above handmade paper textures',
  'A diagram-like city skyline with poetic light and precise geometry',
] as const;

const createSchema = z.object({
  title: z.string().optional(),
  prompt: z.string().optional(),
  style: z.enum(styleValues).optional(),
  iterativeMode: z
    .boolean()
    .optional()
    .describe('Reuse a stable seed for more consistent generations'),
  userAPIKey: z.string().optional(),
  autoRegenerate: z
    .boolean()
    .optional()
    .describe('Auto-generate after prompt changes instead of waiting for a click'),
  autoDropToCanvas: z
    .boolean()
    .optional()
    .describe('Automatically insert newly generated images onto the canvas as shapes'),
  canvasSize: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  showControls: z.boolean().optional(),
  enableSpeechToText: z.boolean().optional(),
  speechPromptMode: z.enum(['replace', 'append']).optional(),
  placeholder: z.string().optional(),
  className: z.string().optional(),
  lastUpdated: z.number().optional(),
});

const mutablePatchSchema = z
  .object({
    title: z.string().optional(),
    prompt: z.string().optional(),
    style: z.enum(styleValues).optional(),
    iterativeMode: z.boolean().optional(),
    autoRegenerate: z.boolean().optional(),
    autoDropToCanvas: z.boolean().optional(),
    showControls: z.boolean().optional(),
    enableSpeechToText: z.boolean().optional(),
    speechPromptMode: z.enum(['replace', 'append']).optional(),
    placeholder: z.string().optional(),
  })
  .partial();

const commandPatchSchema = z
  .object({
    generate: z.boolean().optional(),
    regenerate: z.boolean().optional(),
    promoteLatest: z.boolean().optional(),
    dropLatest: z.boolean().optional(),
    clearHistory: z.boolean().optional(),
    appendPrompt: z.string().optional(),
    replacePrompt: z.string().optional(),
  })
  .partial()
  .passthrough();

export const aiImageGeneratorSchema = createSchema.extend({
  prompt: z
    .string()
    .optional()
    .describe('Image prompt. Leave blank to open an empty composer on the canvas.'),
});

export type AIImageGeneratorProps = z.infer<typeof aiImageGeneratorSchema> & {
  __custom_message_id?: string;
  messageId?: string;
  contextKey?: string;
};

type ImageResponse = {
  b64_json: string;
  timings?: { inference?: number };
  providerUsed?: string | null;
  fallbackReason?: string | null;
};

type GeneratedImage = {
  id: string;
  prompt: string;
  style?: (typeof imageStyles)[number]['value'];
  b64: string;
  url: string;
  width: number;
  height: number;
  generatedAt: number;
  inferenceMs: number;
  providerUsed?: string | null;
  fallbackReason?: string | null;
};

type GeneratedImageSummary = {
  id: string;
  prompt: string;
  style?: (typeof imageStyles)[number]['value'];
  width: number;
  height: number;
  generatedAt: number;
};

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;

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

function buildDataUrl(b64: string) {
  return `data:image/png;base64,${b64}`;
}

function normalizePromptAppend(current: string, append: string) {
  const trimmedAppend = append.trim();
  if (!trimmedAppend) return current;
  const trimmedCurrent = current.trim();
  return trimmedCurrent ? `${trimmedCurrent} ${trimmedAppend}` : trimmedAppend;
}

export function AIImageGenerator({
  __custom_message_id,
  messageId: propMessageId,
  contextKey,
  title = 'Image Draft',
  prompt = '',
  style,
  iterativeMode = false,
  userAPIKey,
  autoRegenerate = false,
  autoDropToCanvas = true,
  canvasSize,
  showControls = true,
  enableSpeechToText = false,
  speechPromptMode = 'append',
  placeholder = 'Describe one clear subject, one clear mood, one clear composition…',
  className,
}: AIImageGeneratorProps) {
  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = `ai-image-generator-${crypto.randomUUID()}`;
  }

  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;
  const registryContext = contextKey || 'canvas';
  const room = useRoomContext();
  const transcripts = useAllTranscripts();

  const [promptText, setPromptText] = useState(prompt);
  const [widgetTitle, setWidgetTitle] = useState(title);
  const [selectedStyle, setSelectedStyle] = useState<typeof style>(style);
  const [seedMode, setSeedMode] = useState(iterativeMode);
  const [autoRegenerateEnabled, setAutoRegenerateEnabled] = useState(autoRegenerate);
  const [autoDrop, setAutoDrop] = useState(autoDropToCanvas);
  const [controlsVisible, setControlsVisible] = useState(showControls);
  const [speechEnabled, setSpeechEnabled] = useState(enableSpeechToText);
  const [promptMode, setPromptMode] = useState(speechPromptMode);
  const [placeholderText, setPlaceholderText] = useState(placeholder);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInferenceMs, setLastInferenceMs] = useState<number | null>(null);

  const processedTranscriptIdsRef = useRef(new Set<string>());
  const promotedIdsRef = useRef(new Set<string>());
  const requestSequenceRef = useRef(0);
  const latestPromptSignatureRef = useRef<string | null>(null);
  const currentImageRef = useRef<GeneratedImage | null>(null);
  const promptRef = useRef(promptText);
  const autoRegenerateRef = useRef(autoRegenerateEnabled);
  const styleRef = useRef(selectedStyle);
  const seedModeRef = useRef(seedMode);
  const autoDropRef = useRef(autoDrop);

  useEffect(() => {
    promptRef.current = promptText;
  }, [promptText]);

  useEffect(() => {
    autoRegenerateRef.current = autoRegenerateEnabled;
  }, [autoRegenerateEnabled]);

  useEffect(() => {
    styleRef.current = selectedStyle;
  }, [selectedStyle]);

  useEffect(() => {
    seedModeRef.current = seedMode;
  }, [seedMode]);

  useEffect(() => {
    autoDropRef.current = autoDrop;
  }, [autoDrop]);

  useEffect(() => {
    setPromptText(prompt);
  }, [prompt]);

  useEffect(() => {
    setWidgetTitle(title);
  }, [title]);

  useEffect(() => {
    setSelectedStyle(style);
  }, [style]);

  useEffect(() => {
    setSeedMode(iterativeMode);
  }, [iterativeMode]);

  useEffect(() => {
    setAutoRegenerateEnabled(autoRegenerate);
  }, [autoRegenerate]);

  useEffect(() => {
    setAutoDrop(autoDropToCanvas);
  }, [autoDropToCanvas]);

  useEffect(() => {
    setControlsVisible(showControls);
  }, [showControls]);

  useEffect(() => {
    setSpeechEnabled(enableSpeechToText);
  }, [enableSpeechToText]);

  useEffect(() => {
    setPromptMode(speechPromptMode);
  }, [speechPromptMode]);

  useEffect(() => {
    setPlaceholderText(placeholder);
  }, [placeholder]);

  const currentImage = history[currentIndex] ?? null;
  currentImageRef.current = currentImage;

  const selectedStyleData = useMemo(
    () => imageStyles.find((option) => option.value === selectedStyle),
    [selectedStyle],
  );

  const getDropPlacement = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const editor = (window as typeof window & { __present?: { tldrawEditor?: unknown } }).__present
      ?.tldrawEditor as
      | {
          getCurrentPageShapes?: () => Array<{ id: string; type?: string; props?: Record<string, unknown> }>;
          getShapePageBounds?: (shapeId: string) => { x: number; y: number; w: number; h: number } | null;
        }
      | undefined;
    const widgetShape = editor
      ?.getCurrentPageShapes?.()
      ?.find(
        (shape) =>
          shape?.type === 'custom' &&
          String(shape?.props?.customComponent || '') === messageId,
      );
    const bounds = widgetShape ? editor?.getShapePageBounds?.(widgetShape.id) : null;
    if (!bounds) return null;

    return {
      x: bounds.x + bounds.w + 48,
      y: bounds.y,
    };
  }, [messageId]);

  const promoteImage = useCallback((image: GeneratedImage | null, { force = false } = {}) => {
    if (!image || typeof window === 'undefined') return false;
    if (!force && promotedIdsRef.current.has(image.id)) return false;
    const placement = getDropPlacement();

    window.dispatchEvent(
      new CustomEvent('tldraw:promote_content', {
        detail: {
          id: image.id,
          type: 'image',
          label: image.prompt || 'Generated image',
          data: {
            url: image.url,
            width: image.width,
            height: image.height,
            title: image.prompt || 'Generated image',
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

  const syncSpeechCapture = useCallback(
    async (nextValue: boolean) => {
      if (!room?.localParticipant?.setMicrophoneEnabled) {
        setMicrophoneEnabled(false);
        setSpeechEnabled(false);
        setError('Microphone is unavailable in this room.');
        return;
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(nextValue);
        setMicrophoneEnabled(nextValue);
        setSpeechEnabled(nextValue);
        if (nextValue) {
          setError(null);
        }
      } catch {
        setMicrophoneEnabled(false);
        setSpeechEnabled(false);
        setError('Microphone is unavailable in this room.');
      }
    },
    [room],
  );

  const generateImage = useCallback(
    async (overrides?: {
      prompt?: string;
      style?: typeof style;
      iterativeMode?: boolean;
      dropToCanvas?: boolean;
      forceDrop?: boolean;
    }): Promise<GeneratedImage | null> => {
      const nextPrompt = (overrides?.prompt ?? promptRef.current ?? '').trim();
      const nextStyle = overrides?.style ?? styleRef.current;
      const nextIterativeMode = overrides?.iterativeMode ?? seedModeRef.current;

      if (!nextPrompt) {
        setError('Give the image a direction first.');
        return null;
      }

      const requestId = ++requestSequenceRef.current;
      setIsGenerating(true);
      setError(null);

      try {
        const response = await fetch('/api/generateImages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: nextPrompt,
            style: imageStyles.find((option) => option.value === nextStyle)?.prompt,
            iterativeMode: nextIterativeMode,
            userAPIKey,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || payload?.message || 'Image generation failed');
        }

        const data = payload as ImageResponse;
        const url = buildDataUrl(data.b64_json);
        const dimensions = await measureImage(url);

        if (requestId !== requestSequenceRef.current) {
          return null;
        }

        const generated: GeneratedImage = {
          id: `generated-image-${crypto.randomUUID()}`,
          prompt: nextPrompt,
          style: nextStyle,
          b64: data.b64_json,
          url,
          width: dimensions.width,
          height: dimensions.height,
          generatedAt: Date.now(),
          inferenceMs: data.timings?.inference ?? 0,
          providerUsed: data.providerUsed,
          fallbackReason: data.fallbackReason,
        };

        let nextIndex = 0;
        setHistory((previous) => {
          const deduped = previous.filter((entry) => entry.url !== generated.url);
          const next = [...deduped, generated].slice(-10);
          nextIndex = next.length - 1;
          return next;
        });
        setCurrentIndex(nextIndex);
        setLastInferenceMs(generated.inferenceMs || null);
        if (overrides?.dropToCanvas ?? autoDropRef.current) {
          promoteImage(generated, { force: overrides?.forceDrop });
        }
        return generated;
      } catch (generationError) {
        if (requestId !== requestSequenceRef.current) {
          return null;
        }
        setError(
          generationError instanceof Error
            ? generationError.message
            : 'Image generation failed',
        );
        return null;
      } finally {
        if (requestId === requestSequenceRef.current) {
          setIsGenerating(false);
        }
      }
    },
    [promoteImage, userAPIKey],
  );

  useEffect(() => {
    if (!autoRegenerateEnabled) return;
    const signature = JSON.stringify({
      prompt: promptText.trim(),
      style: selectedStyle,
      iterativeMode: seedMode,
    });

    if (!promptText.trim()) return;
    if (latestPromptSignatureRef.current === signature) return;

    const handle = window.setTimeout(() => {
      latestPromptSignatureRef.current = signature;
      void generateImage();
    }, 450);

    return () => window.clearTimeout(handle);
  }, [autoRegenerateEnabled, generateImage, promptText, selectedStyle, seedMode]);

  useEffect(() => {
    if (!prompt.trim() || autoRegenerateEnabled) return;
    if (history.length > 0) return;

    const signature = JSON.stringify({
      prompt: prompt.trim(),
      style,
      iterativeMode,
      mode: 'initial',
    });

    if (latestPromptSignatureRef.current === signature) return;
    latestPromptSignatureRef.current = signature;
    void generateImage({ prompt, style, iterativeMode });
  }, [autoRegenerateEnabled, generateImage, history.length, iterativeMode, prompt, style]);

  useEffect(() => {
    if (!speechEnabled) return;

    const latest = transcripts[transcripts.length - 1];
    setLiveTranscription(latest?.text || '');

    for (const transcript of transcripts) {
      if (
        !transcript?.isFinal ||
        !transcript?.text?.trim() ||
        processedTranscriptIdsRef.current.has(transcript.id)
      ) {
        continue;
      }

      processedTranscriptIdsRef.current.add(transcript.id);
      setPromptText((previous) =>
        promptMode === 'replace'
          ? transcript.text.trim()
          : normalizePromptAppend(previous, transcript.text),
      );
    }

    if (processedTranscriptIdsRef.current.size > 100) {
      processedTranscriptIdsRef.current = new Set(
        Array.from(processedTranscriptIdsRef.current).slice(-50),
      );
    }
  }, [promptMode, speechEnabled, transcripts]);

  const handleRegistryUpdate = useCallback(
    (patch: Record<string, unknown>) => {
      void (async () => {
        const merged = (patch as { __mergedProps?: Record<string, unknown> }).__mergedProps;
        const persistentSource = merged ?? patch;
        const persistentParsed = mutablePatchSchema.safeParse(persistentSource);
        const commandParsed = commandPatchSchema.safeParse(patch);
        if (!persistentParsed.success && !commandParsed.success) {
          return;
        }

        const next = persistentParsed.success ? persistentParsed.data : {};
        const commands = commandParsed.success ? commandParsed.data : {};

        let nextPrompt = promptRef.current;
        if (typeof commands.replacePrompt === 'string') {
          nextPrompt = commands.replacePrompt;
        } else if (typeof next.prompt === 'string') {
          nextPrompt = next.prompt;
        }
        if (typeof commands.appendPrompt === 'string') {
          nextPrompt = normalizePromptAppend(nextPrompt, commands.appendPrompt);
        }

        const nextStyle = next.style ?? styleRef.current;
        const nextIterativeMode =
          typeof next.iterativeMode === 'boolean' ? next.iterativeMode : seedModeRef.current;
        const nextAutoRegenerate =
          typeof next.autoRegenerate === 'boolean'
            ? next.autoRegenerate
            : autoRegenerateRef.current;
        const nextAutoDrop =
          typeof next.autoDropToCanvas === 'boolean' ? next.autoDropToCanvas : autoDropRef.current;

        if (typeof next.title !== 'undefined') {
          setWidgetTitle(next.title || 'Image Draft');
        }
        if (
          typeof next.prompt === 'string' ||
          typeof commands.replacePrompt === 'string' ||
          typeof commands.appendPrompt === 'string'
        ) {
          setPromptText(nextPrompt);
        }
        if (typeof next.style !== 'undefined') {
          setSelectedStyle(next.style);
        }
        if (typeof next.iterativeMode === 'boolean') {
          setSeedMode(next.iterativeMode);
        }
        if (typeof next.autoRegenerate === 'boolean') {
          setAutoRegenerateEnabled(next.autoRegenerate);
        }
        if (typeof next.autoDropToCanvas === 'boolean') {
          setAutoDrop(next.autoDropToCanvas);
        }
        if (typeof next.showControls === 'boolean') {
          setControlsVisible(next.showControls);
        }
        if (typeof next.speechPromptMode !== 'undefined') {
          setPromptMode(next.speechPromptMode);
        }
        if (typeof next.placeholder !== 'undefined') {
          setPlaceholderText(
            next.placeholder || 'Describe one clear subject, one clear mood, one clear composition…',
          );
        }
        if (typeof next.enableSpeechToText === 'boolean') {
          await syncSpeechCapture(next.enableSpeechToText);
        }
        if (commands.clearHistory) {
          setHistory([]);
          setCurrentIndex(-1);
          setLastInferenceMs(null);
          setError(null);
          promotedIdsRef.current.clear();
        }

        const inputChanged =
          typeof next.prompt === 'string' ||
          typeof commands.replacePrompt === 'string' ||
          typeof commands.appendPrompt === 'string' ||
          typeof next.style !== 'undefined' ||
          typeof next.iterativeMode === 'boolean';
        const wantsGenerate = Boolean(commands.generate || commands.regenerate);
        const wantsDrop = Boolean(commands.promoteLatest || commands.dropLatest);

        if (wantsGenerate || (inputChanged && nextAutoRegenerate)) {
          const generated = await generateImage({
            prompt: nextPrompt,
            style: nextStyle,
            iterativeMode: nextIterativeMode,
            dropToCanvas: wantsDrop || nextAutoDrop,
            forceDrop: wantsDrop,
          });
          if (wantsDrop && !generated) {
            promoteImage(currentImageRef.current, { force: true });
          }
          return;
        }

        if (wantsDrop) {
          promoteImage(currentImageRef.current, { force: true });
        }
      })();
    },
    [generateImage, promoteImage, syncSpeechCapture],
  );

  const promotableItems = useMemo(
    () =>
      currentImage
        ? [
            {
              id: currentImage.id,
              type: 'image' as const,
              label: currentImage.prompt || 'Generated image',
              data: {
                url: currentImage.url,
                width: currentImage.width,
                height: currentImage.height,
                title: currentImage.prompt || 'Generated image',
                sourceComponentId: messageId,
              },
            },
          ]
        : [],
    [currentImage, messageId],
  );

  const registryProps = useMemo(
    () => ({
      title: widgetTitle,
      prompt: promptText,
      style: selectedStyle,
      iterativeMode: seedMode,
      autoRegenerate: autoRegenerateEnabled,
      autoDropToCanvas: autoDrop,
      showControls: controlsVisible,
      enableSpeechToText: speechEnabled,
      speechPromptMode: promptMode,
      placeholder: placeholderText,
      currentImage:
        currentImage && {
          id: currentImage.id,
          width: currentImage.width,
          height: currentImage.height,
          prompt: currentImage.prompt,
        },
      history: history.map<GeneratedImageSummary>((image) => ({
        id: image.id,
        prompt: image.prompt,
        style: image.style,
        width: image.width,
        height: image.height,
        generatedAt: image.generatedAt,
      })),
      providerUsed: currentImage?.providerUsed,
      fallbackReason: currentImage?.fallbackReason,
      status: isGenerating ? 'generating' : error ? 'error' : currentImage ? 'ready' : 'idle',
      lastGenerationTime: lastInferenceMs,
      totalGenerations: history.length,
      error,
      className,
    }),
    [
      autoDrop,
      autoRegenerateEnabled,
      className,
      currentImage,
      error,
      history,
      isGenerating,
      lastInferenceMs,
      placeholderText,
      promptText,
      seedMode,
      selectedStyle,
      controlsVisible,
      speechEnabled,
      promptMode,
      widgetTitle,
    ],
  );

  usePromotable(promotableItems, {
    messageId,
    componentType: 'AIImageGenerator',
    contextKey: registryContext,
    props: registryProps,
    updateCallback: handleRegistryUpdate,
  });

  const handleDownload = useCallback(() => {
    if (!currentImage) return;
    const link = document.createElement('a');
    link.href = currentImage.url;
    link.download = `present-image-${currentImage.generatedAt}.png`;
    link.click();
  }, [currentImage]);

  const toggleMicrophone = useCallback(async () => {
    await syncSpeechCapture(!microphoneEnabled);
  }, [microphoneEnabled, syncSpeechCapture]);

  const promoted = currentImage ? promotedIdsRef.current.has(currentImage.id) : false;

  return (
    <div
      className={cn('w-full', className)}
      style={{
        width: canvasSize?.width,
        minHeight: canvasSize?.height,
      }}
    >
      <WidgetFrame
        title={
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <span>{widgetTitle}</span>
          </div>
        }
        subtitle="Type a prompt. Make the image. Pin it to the board."
        meta={
          currentImage
            ? `${currentImage.providerUsed === 'gemini_ai_studio' ? 'Gemini' : currentImage.providerUsed === 'vertex_ai' ? 'Vertex' : currentImage.providerUsed === 'together_flux' ? 'Flux' : 'Generator'}${lastInferenceMs ? ` · ${(lastInferenceMs / 1000).toFixed(1)}s` : ''}`
            : 'Canvas-native image generation'
        }
        actions={
          controlsVisible ? (
            <>
              <button
                type="button"
                onClick={() => setAutoDrop((value) => !value)}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition',
                  autoDrop
                    ? 'border-amber-300 bg-amber-100 text-amber-950'
                    : 'border-default bg-surface text-secondary hover:bg-surface-hover',
                )}
                title="Automatically drop new results onto the canvas"
              >
                {autoDrop ? <Check className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                Auto-drop
              </button>
              <button
                type="button"
                onClick={toggleMicrophone}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-full border transition',
                  microphoneEnabled
                    ? 'border-rose-300 bg-rose-100 text-rose-700'
                    : 'border-default bg-surface text-secondary hover:bg-surface-hover',
                )}
                title={microphoneEnabled ? 'Disable microphone capture' : 'Enable microphone capture'}
              >
                {microphoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
            </>
          ) : undefined
        }
        bodyClassName="space-y-4 bg-[radial-gradient(circle_at_top_left,rgba(251,241,215,0.35),transparent_45%),linear-gradient(180deg,rgba(255,248,234,0.58),rgba(255,255,255,0.88))]"
      >
        {controlsVisible ? (
          <div className="grid gap-4">
            <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-[linear-gradient(155deg,#1b130b_0%,#2b1b0f_38%,#4c301c_100%)] p-4 text-white shadow-[0_18px_60px_rgba(60,32,6,0.18)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,214,153,0.28),transparent_33%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_28%)]" />
              <div className="relative space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-white/60">
                      Prompt Composer
                    </p>
                    <p className="mt-1 text-sm text-white/80">
                      One decisive subject beats ten vague adjectives.
                    </p>
                  </div>
                  <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/70">
                    Cmd+Enter
                  </div>
                </div>

                <label className="block">
                  <span className="sr-only">Image prompt</span>
                  <textarea
                    value={promptText}
                    onChange={(event) => setPromptText(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void generateImage();
                      }
                    }}
                    placeholder={placeholderText}
                    className="min-h-[120px] w-full resize-none rounded-[22px] border border-white/15 bg-black/20 px-4 py-4 text-[15px] leading-6 text-white placeholder:text-white/45 shadow-inner outline-none transition focus:border-amber-200/70 focus:bg-black/25"
                  />
                </label>

                {!promptText.trim() ? (
                  <div className="flex flex-wrap gap-2">
                    {quickStarts.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPromptText(item)}
                        className="rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-white/78 transition hover:bg-white/14"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {imageStyles.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setSelectedStyle((current) =>
                          current === option.value ? undefined : option.value,
                        )
                      }
                      className={cn(
                        'group inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition',
                        selectedStyle === option.value
                          ? 'border-white/25 bg-white text-stone-900'
                          : 'border-white/15 bg-white/8 text-white/78 hover:bg-white/14',
                      )}
                    >
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full bg-gradient-to-br',
                          option.accent,
                        )}
                      />
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSeedMode((value) => !value)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition',
                      seedMode
                        ? 'border-amber-200/60 bg-amber-100 text-amber-950'
                        : 'border-white/15 bg-white/8 text-white/78 hover:bg-white/14',
                    )}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Consistent seed
                  </button>
                  {speechEnabled && liveTranscription ? (
                    <div className="max-w-full rounded-full border border-sky-200/30 bg-sky-100/15 px-3 py-2 text-xs text-sky-50">
                      Listening: “{liveTranscription}”
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_104px]">
              <div className="relative min-h-[340px] overflow-hidden rounded-[30px] border border-black/8 bg-[linear-gradient(180deg,#f7f1e4_0%,#f3e4cb_50%,#e8d2b0_100%)] p-3 shadow-[0_24px_80px_rgba(126,84,19,0.12)]">
                <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(86,57,16,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(86,57,16,0.06)_1px,transparent_1px)] [background-size:18px_18px]" />
                <div className="relative h-full overflow-hidden rounded-[24px] border border-black/8 bg-[#20150d]">
                  {currentImage ? (
                    <>
                      <img
                        src={currentImage.url}
                        alt={currentImage.prompt || 'Generated image'}
                        className={cn(
                          'h-full w-full object-cover transition duration-500',
                          isGenerating && 'scale-[1.01] opacity-70',
                        )}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 text-white">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.3em] text-white/60">
                              Latest
                            </p>
                            <p className="mt-1 line-clamp-2 text-sm font-medium">
                              {currentImage.prompt}
                            </p>
                          </div>
                          {currentImage.style ? (
                            <div className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
                              {imageStyles.find((option) => option.value === currentImage.style)?.label ||
                                currentImage.style}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center text-[#f5e7cf]">
                      {isGenerating ? (
                        <Loader2 className="h-10 w-10 animate-spin text-amber-200" />
                      ) : (
                        <Wand2 className="h-10 w-10 text-amber-200/80" />
                      )}
                      <div className="space-y-2">
                        <p className="text-base font-medium">
                          {isGenerating ? 'Rendering the image…' : 'No image yet'}
                        </p>
                        <p className="text-sm text-[#f5e7cf]/72">
                          The widget is just the drafting desk. The result belongs on the canvas.
                        </p>
                      </div>
                    </div>
                  )}

                  {isGenerating ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/14 backdrop-blur-[1px]">
                      <div className="rounded-full border border-white/15 bg-black/45 px-4 py-2 text-sm text-white">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Generating
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex gap-2 lg:flex-col">
                <Button
                  onClick={() => void generateImage()}
                  disabled={isGenerating || !promptText.trim()}
                  className="w-full justify-center bg-[#20150d] text-[#f7ebd6] hover:bg-[#2a1a10]"
                >
                  {isGenerating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Generate
                </Button>
                <Button
                  variant="outline"
                  onClick={() => promoteImage(currentImage, { force: true })}
                  disabled={!currentImage}
                  className="w-full justify-center"
                >
                  <Pin className="mr-2 h-4 w-4" />
                  {promoted ? 'Drop Again' : 'Drop'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void generateImage()}
                  disabled={isGenerating || !promptText.trim()}
                  className="w-full justify-center"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reroll
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleDownload}
                  disabled={!currentImage}
                  className="w-full justify-center"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Save
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {!controlsVisible && currentImage ? (
          <div className="overflow-hidden rounded-[24px] border border-black/10">
            <img
              src={currentImage.url}
              alt={currentImage.prompt || 'Generated image'}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
          <span className="inline-flex items-center gap-1 rounded-full border border-default bg-surface px-3 py-1">
            <Palette className="h-3.5 w-3.5" />
            {selectedStyleData?.label || 'No style'}
          </span>
          <span className="rounded-full border border-default bg-surface px-3 py-1">
            {history.length} {history.length === 1 ? 'image' : 'images'}
          </span>
          <span className="rounded-full border border-default bg-surface px-3 py-1">
            {autoDrop ? 'Auto-drop on' : 'Manual drop'}
          </span>
          {error ? (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700">
              {error}
            </span>
          ) : null}
        </div>

        {history.length > 1 ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {history.map((image, index) => {
              const active = index === currentIndex;
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  className={cn(
                    'group overflow-hidden rounded-2xl border bg-black transition',
                    active
                      ? 'border-amber-300 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]'
                      : 'border-black/8 hover:border-amber-200/60',
                  )}
                  title={image.prompt}
                >
                  <img
                    src={image.url}
                    alt=""
                    className={cn(
                      'aspect-[4/3] h-full w-full object-cover transition duration-300',
                      active ? 'opacity-100' : 'opacity-80 group-hover:opacity-100',
                    )}
                  />
                </button>
              );
            })}
          </div>
        ) : null}
      </WidgetFrame>
    </div>
  );
}

export default AIImageGenerator;
