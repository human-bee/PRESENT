/**
 * AI Image Generator component for the Next.js application.
 *
 * This component serves as a generative image generator using AI.
 * It includes:
 * - A form for entering a prompt
 * - A list of image styles
 * - A live transcription display
 * - A main image display
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import Image from 'next/image';
import {
  Loader2,
  RefreshCw,
  Download,
  Eye,
  Palette,
  Wand2,
  Sparkles,
  Mic,
  MicOff,
} from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useAllTranscripts } from '@/lib/stores/transcript-store';

// Schema for image styles
const imageStyleSchema = z.object({
  label: z.string(),
  value: z.string(),
  prompt: z.string(),
});

// Define the schema for the AI Image Generator component
export const aiImageGeneratorSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .describe('The image generation prompt describing what to create'),
  style: z
    .enum([
      'pop-art',
      'minimal',
      'retro',
      'watercolor',
      'fantasy',
      'moody',
      'vibrant',
      'cinematic',
      'cyberpunk',
      'surreal',
      'art-deco',
      'graffiti',
    ])
    .optional()
    .describe('Visual style to apply to the image (default: none)'),
  iterativeMode: z
    .boolean()
    .optional()
    .describe('Use consistency mode for similar images (default: false)'),
  userAPIKey: z
    .string()
    .optional()
    .describe("User's Together AI API key for unlimited generations"),
  autoRegenerate: z
    .boolean()
    .optional()
    .describe('Automatically regenerate when prompt changes (default: true)'),
  canvasSize: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .describe('Size constraints for canvas display'),
  showControls: z.boolean().optional().describe('Show generation controls (default: true)'),
  enableSpeechToText: z
    .boolean()
    .optional()
    .describe('Enable speech-to-text integration for voice-driven prompts (default: false)'),
  speechPromptMode: z
    .enum(['replace', 'append'])
    .optional()
    .describe(
      'How to handle speech input: replace existing prompt or append to it (default: append)',
    ),
});

export type AIImageGeneratorProps = z.infer<typeof aiImageGeneratorSchema>;

// Component state type
type AIImageGeneratorState = {
  currentImageIndex: number;
  isExpanded: boolean;
  showStyleSelector: boolean;
  generationHistory: Array<{
    prompt: string;
    style?: string;
    imageData: string;
    timestamp: Date;
  }>;
  lastGenerationTime: number;
  totalGenerations: number;
  canvasInteractions: number;
  microphoneEnabled: boolean;
  speechToTextEnabled: boolean;
  liveTranscription: string;
  lastTranscriptionTime: number;
  transcriptionHistory: Array<{
    text: string;
    speaker: string;
    timestamp: number;
    isFinal: boolean;
  }>;
};

// Image style definitions
const imageStyles = [
  {
    label: 'Pop Art',
    value: 'pop-art',
    prompt:
      'Create an image in the bold and vibrant style of classic pop art, using bright primary colors, thick outlines, and a playful comic book flair.',
  },
  {
    label: 'Minimal',
    value: 'minimal',
    prompt:
      'Generate a simple, clean composition with limited shapes and subtle color accents. Emphasize negative space and precise lines.',
  },
  {
    label: 'Retro',
    value: 'retro',
    prompt:
      'Design a vintage-inspired scene with nostalgic color palettes, distressed textures, and bold mid-century typography.',
  },
  {
    label: 'Watercolor',
    value: 'watercolor',
    prompt:
      'Produce a delicate, painterly image emulating fluid watercolor strokes and soft gradients with pastel hues.',
  },
  {
    label: 'Fantasy',
    value: 'fantasy',
    prompt:
      'Illustrate a whimsical realm filled with magical creatures, enchanted forests, and otherworldly elements.',
  },
  {
    label: 'Moody',
    value: 'moody',
    prompt:
      'Craft an atmospheric scene defined by dramatic lighting, deep shadows, and rich textures.',
  },
  {
    label: 'Vibrant',
    value: 'vibrant',
    prompt:
      'Generate an energetic, eye-popping design with bold, saturated hues and dynamic contrasts.',
  },
  {
    label: 'Cinematic',
    value: 'cinematic',
    prompt:
      'Compose a visually stunning frame reminiscent of a movie still, complete with dramatic lighting and color grading.',
  },
  {
    label: 'Cyberpunk',
    value: 'cyberpunk',
    prompt:
      'Envision a futuristic, neon-lit cityscape infused with advanced technology and dystopian undertones.',
  },
  {
    label: 'Surreal',
    value: 'surreal',
    prompt:
      'Construct a dreamlike world blending unexpected, fantastical elements in bizarre yet captivating ways.',
  },
  {
    label: 'Art Deco',
    value: 'art-deco',
    prompt:
      'Design a scene characterized by bold geometric shapes, streamlined forms, and luxe metallic accents.',
  },
  {
    label: 'Graffiti',
    value: 'graffiti',
    prompt:
      'Produce an urban-inspired piece rich with spray paint textures, edgy lettering, and vibrant color bursts.',
  },
];

type ImageResponse = {
  b64_json: string;
  timings: { inference: number };
};

export function AIImageGenerator({
  prompt = '',
  style,
  iterativeMode = false,
  userAPIKey,
  autoRegenerate = true,
  canvasSize,
  showControls = true,
  enableSpeechToText = false,
  speechPromptMode = 'append',
}: AIImageGeneratorProps) {
  // Defensive check for prompt
  const safePrompt = prompt || '';
  const componentId = `ai-image-generator-${safePrompt.slice(0, 20) || 'default'}`;

  const [state, setState] = useState<AIImageGeneratorState>({
    currentImageIndex: 0,
    id: 'asdf',
    isExpanded: false,
    showStyleSelector: false,
    generationHistory: [],
    lastGenerationTime: 0,
    totalGenerations: 0,
    canvasInteractions: 0,
    microphoneEnabled: false,
    speechToTextEnabled: enableSpeechToText,
    liveTranscription: '',
    lastTranscriptionTime: 0,
    transcriptionHistory: [],
  });

  const [localPrompt, setLocalPrompt] = useState(safePrompt);
  const [localStyle, setLocalStyle] = useState(style);
  const debouncedPrompt = useDebounce(localPrompt, 350);

  // LiveKit integration for microphone and transcription
  const room = useRoomContext();

  const selectedStyleData = imageStyles.find((s) => s.value === localStyle);

  // Build the full prompt with style
  const fullPrompt =
    localStyle && selectedStyleData
      ? `${debouncedPrompt}. ${selectedStyleData.prompt}`
      : debouncedPrompt;

  // Image generation query
  const {
    data: image,
    isFetching,
    error,
    refetch,
  } = useQuery({
    placeholderData: (previousData) => previousData,
    queryKey: [fullPrompt, localStyle, iterativeMode],
    queryFn: async (): Promise<ImageResponse> => {
      const response = await fetch('/api/generateImages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: debouncedPrompt,
          style: selectedStyleData?.prompt,
          userAPIKey,
          iterativeMode,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: !!debouncedPrompt.trim() && autoRegenerate,
    staleTime: Infinity,
    retry: false,
  });

  // Update generation history when new image arrives
  useEffect(() => {
    if (image && state) {
      const existingImages = state.generationHistory.map((h) => h.imageData);
      if (!existingImages.includes(image.b64_json)) {
        const newHistory = [
          ...state.generationHistory,
          {
            prompt: localPrompt,
            style: localStyle,
            imageData: image.b64_json,
            timestamp: new Date(),
          },
        ].slice(-10); // Keep last 10 images

        setState({
          ...state,
          generationHistory: newHistory,
          currentImageIndex: newHistory.length - 1,
          lastGenerationTime: image.timings?.inference || 0,
          totalGenerations: state.totalGenerations + 1,
        });

        // Notify canvas of new image
        window.dispatchEvent(
          new CustomEvent('custom:componentUpdate', {
            detail: {
              componentId,
              imageGenerated: true,
              generationTime: image.timings?.inference,
            },
          }),
        );
      }
    }
  }, [image, state, setState, localPrompt, localStyle, prompt]);

  // Listen for canvas interactions
  useEffect(() => {
    const handleCanvasInteraction = (event: CustomEvent) => {
      if (event.detail.componentId === componentId) {
        setState((prevState) => {
          if (!prevState) return prevState;
          return {
            ...prevState,
            canvasInteractions: prevState.canvasInteractions + 1,
          };
        });
      }
    };

    window.addEventListener('custom:canvas:interaction', handleCanvasInteraction as EventListener);

    return () => {
      window.removeEventListener(
        'custom:canvas:interaction',
        handleCanvasInteraction as EventListener,
      );
    };
  }, [componentId, setState]);

  // Microphone toggle functionality
  const toggleMicrophone = useCallback(async () => {
    if (!room || !state) return;

    try {
      const newMicState = !state.microphoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(newMicState);

      setState({
        ...state,
        microphoneEnabled: newMicState,
        speechToTextEnabled: newMicState, // Enable STT when mic is enabled
      });

      console.log(`Microphone ${newMicState ? 'enabled' : 'disabled'} for AI Image Generator`);
    } catch (error) {
      console.error('Error toggling microphone:', error);
    }
  }, [room, state, setState]);

  // Get transcripts from centralized store
  const storeTranscripts = useAllTranscripts();
  
  // Track processed transcript IDs to avoid re-processing
  const processedTranscriptIdsRef = React.useRef(new Set<string>());
  
  // Sync store transcripts to local state and handle prompt updates
  useEffect(() => {
    if (!state?.speechToTextEnabled) return;
    
    // Get the latest transcript
    const latestTranscripts = storeTranscripts.slice(-10);
    
    // Update transcription history for display
    const transcriptionHistory = latestTranscripts.map(t => ({
      text: t.text,
      speaker: t.speaker,
      timestamp: t.timestamp,
      isFinal: t.isFinal,
    }));
    
    // Find the latest transcript for live display
    const latest = storeTranscripts[storeTranscripts.length - 1];
    
    // Update state with new transcription data
    setState((prevState) => {
      if (!prevState) return prevState;
      return {
        ...prevState,
        liveTranscription: latest?.text || '',
        lastTranscriptionTime: latest?.timestamp || 0,
        transcriptionHistory,
      };
    });
    
    // Handle prompt updates for new final transcripts
    for (const t of storeTranscripts) {
      if (t.isFinal && t.text.trim() && !processedTranscriptIdsRef.current.has(t.id)) {
        processedTranscriptIdsRef.current.add(t.id);
        
        const transcribedText = t.text.trim();
        
        if (speechPromptMode === 'replace') {
          setLocalPrompt(transcribedText);
          console.log(`Replaced image prompt from speech: "${transcribedText}"`);
        } else {
          setLocalPrompt((prev) => {
            const currentPrompt = prev.trim();
            return currentPrompt ? `${currentPrompt} ${transcribedText}` : transcribedText;
          });
          console.log(`Appended to image prompt from speech: "${transcribedText}"`);
        }
      }
    }
    
    // Keep the set from growing unbounded
    if (processedTranscriptIdsRef.current.size > 100) {
      const arr = Array.from(processedTranscriptIdsRef.current);
      processedTranscriptIdsRef.current = new Set(arr.slice(-50));
    }
  }, [storeTranscripts, state?.speechToTextEnabled, speechPromptMode, setState]);

  // Show component on canvas when mounted
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('custom:showComponent', {
        detail: {
          messageId: `ai-image-generator-${safePrompt}`,
          component: (
            <AIImageGenerator
              prompt={safePrompt}
              style={style}
              iterativeMode={iterativeMode}
              userAPIKey={userAPIKey}
              autoRegenerate={autoRegenerate}
              canvasSize={canvasSize}
              showControls={showControls}
              enableSpeechToText={enableSpeechToText}
              speechPromptMode={speechPromptMode}
            />
          ),
        },
      }),
    );
  }, [
    safePrompt,
    style,
    iterativeMode,
    userAPIKey,
    autoRegenerate,
    canvasSize,
    showControls,
    enableSpeechToText,
    speechPromptMode,
  ]);

  const currentImage = state?.generationHistory[state.currentImageIndex];
  const isDebouncing = localPrompt !== debouncedPrompt;

  const handleManualRegenerate = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleStyleSelect = useCallback(
    (styleValue: string) => {
      setLocalStyle(styleValue === localStyle ? undefined : styleValue);
      setState((prev) => (prev ? { ...prev, showStyleSelector: false } : prev));
    },
    [localStyle, setState],
  );

  const handleImageSelect = useCallback(
    (index: number) => {
      setState((prev) => (prev ? { ...prev, currentImageIndex: index } : prev));
    },
    [setState],
  );

  const toggleExpanded = useCallback(() => {
    setState((prev) => (prev ? { ...prev, isExpanded: !prev.isExpanded } : prev));
  }, [setState]);

  const handleDownload = useCallback(() => {
    if (currentImage) {
      const link = document.createElement('a');
      link.download = `ai-generated-${Date.now()}.png`;
      link.href = `data:image/png;base64,${currentImage.imageData}`;
      link.click();
    }
  }, [currentImage]);

  // Loading state or empty prompt
  if (!currentImage && !error) {
    return (
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-lg flex items-center justify-center"
        style={{
          width: canvasSize?.width || (state?.isExpanded ? '500px' : '350px'),
          height: canvasSize?.height || (state?.isExpanded ? '400px' : '300px'),
          minWidth: '250px',
          minHeight: '200px',
        }}
      >
        <div className="text-center p-6">
          <div className="flex items-center justify-center mb-4">
            {isFetching || isDebouncing ? (
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            ) : (
              <Wand2 className="w-8 h-8 text-gray-400" />
            )}
          </div>
          <p className="text-gray-300 text-sm">
            {!safePrompt.trim()
              ? 'Enter a prompt to generate images'
              : isFetching || isDebouncing
                ? 'Generating image...'
                : 'Ready to generate'}
          </p>
          {debouncedPrompt && (
            <p className="text-gray-500 text-xs mt-2 max-w-xs truncate">"{debouncedPrompt}"</p>
          )}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="bg-red-900 border border-red-700 rounded-lg shadow-lg p-4"
        style={{
          width: canvasSize?.width || '350px',
          height: canvasSize?.height || '200px',
          minWidth: '250px',
          minHeight: '150px',
        }}
      >
        <div className="text-center">
          <p className="text-red-300 text-sm mb-2">Generation failed</p>
          <p className="text-red-400 text-xs mb-4">{String(error)}</p>
          <button
            onClick={handleManualRegenerate}
            className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-500 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-gray-900 border border-gray-700 rounded-lg shadow-lg overflow-hidden transition-all duration-300"
      style={{
        width: canvasSize?.width || (state?.isExpanded ? '600px' : '400px'),
        height: canvasSize?.height || (state?.isExpanded ? '500px' : '350px'),
        minWidth: '300px',
        minHeight: '250px',
      }}
    >
      {/* Header */}
      {showControls && (
        <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span className="text-gray-200 text-sm font-medium">AI Image Generator</span>
            {selectedStyleData && (
              <span className="px-2 py-0.5 bg-blue-900 text-blue-300 text-xs rounded">
                {selectedStyleData.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMicrophone}
              className={cn(
                'p-1 rounded transition-colors',
                state?.microphoneEnabled
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300',
              )}
              title={state?.microphoneEnabled ? 'Disable microphone' : 'Enable microphone'}
            >
              {state?.microphoneEnabled ? (
                <Mic className="w-4 h-4" />
              ) : (
                <MicOff className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleManualRegenerate}
              disabled={isFetching}
              className="p-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
              title="Regenerate image"
            >
              <RefreshCw className={cn('w-4 h-4 text-gray-300', isFetching && 'animate-spin')} />
            </button>
            <button
              onClick={() =>
                setState((prev) =>
                  prev ? { ...prev, showStyleSelector: !prev.showStyleSelector } : prev,
                )
              }
              className="p-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
              title="Select style"
            >
              <Palette className="w-4 h-4 text-gray-300" />
            </button>
            <button
              onClick={toggleExpanded}
              className="p-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
              title={state?.isExpanded ? 'Collapse' : 'Expand'}
            >
              <Eye className="w-4 h-4 text-gray-300" />
            </button>
          </div>
        </div>
      )}

      {/* Style Selector */}
      {state?.showStyleSelector && showControls && (
        <div className="bg-gray-850 border-b border-gray-700 p-3">
          <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto">
            {imageStyles.map((styleOption) => (
              <button
                key={styleOption.value}
                onClick={() => handleStyleSelect(styleOption.value)}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  localStyle === styleOption.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                )}
              >
                {styleOption.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live Transcription Display */}
      {state?.speechToTextEnabled && showControls && state?.liveTranscription && (
        <div className="bg-blue-900 border-b border-blue-700 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-blue-200 text-xs font-medium">Live Speech-to-Text</span>
          </div>
          <p className="text-blue-100 text-sm">"{state.liveTranscription}"</p>
          {state.transcriptionHistory.length > 0 && (
            <div className="mt-2 pt-2 border-t border-blue-700">
              <p className="text-blue-300 text-xs">
                Recent: {state.transcriptionHistory.slice(-1)[0]?.text}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Main Image Display */}
      <div className="flex-1 relative">
        {currentImage && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="relative max-w-full max-h-full">
              <Image
                src={`data:image/png;base64,${currentImage.imageData}`}
                alt={currentImage.prompt}
                width={1024}
                height={768}
                className={cn(
                  'max-w-full max-h-full object-contain rounded',
                  isFetching && 'animate-pulse opacity-70',
                )}
                priority
              />
              {isFetching && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black/50 rounded-full p-3">
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      {showControls && (
        <div className="bg-gray-800 px-4 py-2">
          {/* Generation History */}
          {state?.generationHistory && state.generationHistory.length > 1 && (
            <div className="flex gap-2 mb-2 overflow-x-auto">
              {state.generationHistory.map((historyItem, index) => (
                <button
                  key={index}
                  onClick={() => handleImageSelect(index)}
                  className={cn(
                    'flex-shrink-0 w-12 h-8 rounded border-2 transition-all overflow-hidden',
                    state.currentImageIndex === index
                      ? 'border-blue-400'
                      : 'border-gray-600 opacity-60 hover:opacity-80',
                  )}
                >
                  <Image
                    src={`data:image/png;base64,${historyItem.imageData}`}
                    alt=""
                    width={48}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Stats and Actions */}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span>Images: {state?.totalGenerations || 0}</span>
              {state?.lastGenerationTime && (
                <span>{(state.lastGenerationTime / 1000).toFixed(1)}s</span>
              )}
              {state?.canvasInteractions > 0 && <span>Canvas: {state.canvasInteractions}</span>}
              {state?.speechToTextEnabled && <span className="text-blue-400">🎤 STT</span>}
              {state?.transcriptionHistory && state.transcriptionHistory.length > 0 && (
                <span>Speech: {state.transcriptionHistory.length}</span>
              )}
            </div>
            <button
              onClick={handleDownload}
              disabled={!currentImage}
              className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-3 h-3" />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AIImageGenerator;
