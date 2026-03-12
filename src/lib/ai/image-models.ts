export const IMAGE_MODEL_IDS = [
  'google-nano-banana-2',
  'xai-grok-imagine-image',
  'openai-gpt-image-1_5-high',
  'fal-flux-2-dev-flash',
] as const;

export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number];

export const IMAGE_ASPECT_RATIOS = ['1:1', '4:5', '3:4', '16:9', '9:16'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const IMAGE_RESOLUTION_PRESETS = ['sd', 'hd', '4k'] as const;
export type ImageResolutionPreset = (typeof IMAGE_RESOLUTION_PRESETS)[number];

export const IMAGE_QUALITY_PRESETS = ['auto', 'standard', 'high'] as const;
export type ImageQualityPreset = (typeof IMAGE_QUALITY_PRESETS)[number];

export const IMAGE_COUNT_OPTIONS = [1] as const;
export type ImageCountOption = (typeof IMAGE_COUNT_OPTIONS)[number];

export type ImageModelDefinition = {
  id: ImageModelId;
  provider: 'google' | 'xai' | 'openai' | 'fal';
  label: string;
  shortLabel: string;
  tier: 'cheap' | 'fast' | 'pro' | 'alt';
  blurb: string;
  supportsSeed: boolean;
  supportsGrounding: boolean;
  supportedResolutionPresets: ImageResolutionPreset[];
  supportedAspectRatios: readonly ImageAspectRatio[];
  supportedImageCounts: readonly ImageCountOption[];
  supportedQualities: readonly ImageQualityPreset[];
};

export const IMAGE_MODELS: readonly ImageModelDefinition[] = [
  {
    id: 'google-nano-banana-2',
    provider: 'google',
    label: 'Nano Banana 2',
    shortLabel: 'Google',
    tier: 'fast',
    blurb: 'Gemini 3.1 Flash Image preview with the best balance of speed, text rendering, and polish.',
    supportsSeed: false,
    supportsGrounding: true,
    supportedResolutionPresets: ['sd', 'hd', '4k'],
    supportedAspectRatios: IMAGE_ASPECT_RATIOS,
    supportedImageCounts: [1],
    supportedQualities: ['auto'],
  },
  {
    id: 'xai-grok-imagine-image',
    provider: 'xai',
    label: 'grok-imagine-image',
    shortLabel: 'xAI',
    tier: 'alt',
    blurb: 'Strong stylistic variation and decent cost with modern aspect-ratio and 2k controls.',
    supportsSeed: false,
    supportsGrounding: false,
    supportedResolutionPresets: ['sd', 'hd'],
    supportedAspectRatios: IMAGE_ASPECT_RATIOS,
    supportedImageCounts: [1],
    supportedQualities: ['auto'],
  },
  {
    id: 'openai-gpt-image-1_5-high',
    provider: 'openai',
    label: 'GPT Image 1.5',
    shortLabel: 'OpenAI',
    tier: 'pro',
    blurb: 'Premium lane for highest prompt adherence and finished campaign art.',
    supportsSeed: false,
    supportsGrounding: false,
    supportedResolutionPresets: ['sd', 'hd'],
    supportedAspectRatios: IMAGE_ASPECT_RATIOS,
    supportedImageCounts: [1],
    supportedQualities: ['standard', 'high'],
  },
  {
    id: 'fal-flux-2-dev-flash',
    provider: 'fal',
    label: 'FLUX.2 [dev] Flash',
    shortLabel: 'fal',
    tier: 'cheap',
    blurb: 'Lowest-cost draft engine with repeatable seeds and sharp iteration speed.',
    supportsSeed: true,
    supportsGrounding: false,
    supportedResolutionPresets: ['sd', 'hd', '4k'],
    supportedAspectRatios: IMAGE_ASPECT_RATIOS,
    supportedImageCounts: [1],
    supportedQualities: ['auto'],
  },
] as const;

export const DEFAULT_IMAGE_MODEL_ID: ImageModelId = 'google-nano-banana-2';
export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '4:5';
export const DEFAULT_IMAGE_RESOLUTION_PRESET: ImageResolutionPreset = 'hd';
export const DEFAULT_IMAGE_QUALITY_PRESET: ImageQualityPreset = 'auto';
export const DEFAULT_IMAGE_COUNT: ImageCountOption = 1;

export function getImageModelDefinition(modelId: string | null | undefined): ImageModelDefinition {
  return IMAGE_MODELS.find((model) => model.id === modelId) ?? IMAGE_MODELS[0];
}

export function toImageLabel(modelId: string | null | undefined): string {
  return getImageModelDefinition(modelId).label;
}

export function clampAspectRatio(
  modelId: string | null | undefined,
  aspectRatio: string | null | undefined,
): ImageAspectRatio {
  const definition = getImageModelDefinition(modelId);
  const candidate = IMAGE_ASPECT_RATIOS.find((ratio) => ratio === aspectRatio);
  if (candidate && definition.supportedAspectRatios.includes(candidate)) {
    return candidate;
  }
  return DEFAULT_IMAGE_ASPECT_RATIO;
}

export function clampResolutionPreset(
  modelId: string | null | undefined,
  resolution: string | null | undefined,
): ImageResolutionPreset {
  const definition = getImageModelDefinition(modelId);
  const candidate = IMAGE_RESOLUTION_PRESETS.find((preset) => preset === resolution);
  if (candidate && definition.supportedResolutionPresets.includes(candidate)) {
    return candidate;
  }
  return definition.supportedResolutionPresets.includes(DEFAULT_IMAGE_RESOLUTION_PRESET)
    ? DEFAULT_IMAGE_RESOLUTION_PRESET
    : definition.supportedResolutionPresets[0];
}

export function clampQualityPreset(
  modelId: string | null | undefined,
  quality: string | null | undefined,
): ImageQualityPreset {
  const definition = getImageModelDefinition(modelId);
  const candidate = IMAGE_QUALITY_PRESETS.find((preset) => preset === quality);
  if (candidate && definition.supportedQualities.includes(candidate)) {
    return candidate;
  }
  return definition.supportedQualities.includes(DEFAULT_IMAGE_QUALITY_PRESET)
    ? DEFAULT_IMAGE_QUALITY_PRESET
    : definition.supportedQualities[0];
}

export function clampImageCount(
  modelId: string | null | undefined,
  count: number | null | undefined,
): ImageCountOption {
  const definition = getImageModelDefinition(modelId);
  const candidate = IMAGE_COUNT_OPTIONS.find((option) => option === count);
  if (candidate && definition.supportedImageCounts.includes(candidate)) {
    return candidate;
  }
  return definition.supportedImageCounts.includes(DEFAULT_IMAGE_COUNT)
    ? DEFAULT_IMAGE_COUNT
    : definition.supportedImageCounts[0];
}

export function getAspectRatioDimensions(
  aspectRatio: ImageAspectRatio,
  resolution: ImageResolutionPreset,
): { width: number; height: number } {
  const longEdge =
    resolution === 'sd' ? 1024 : resolution === 'hd' ? 1536 : 2048;
  const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number);
  const ratio = widthRatio / heightRatio;
  if (ratio >= 1) {
    return {
      width: longEdge,
      height: Math.round(longEdge / ratio),
    };
  }
  return {
    width: Math.round(longEdge * ratio),
    height: longEdge,
  };
}

export function toFalImageSize(
  aspectRatio: ImageAspectRatio,
  resolution: ImageResolutionPreset,
): 'square' | 'square_hd' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9' | { width: number; height: number } {
  if (resolution !== '4k') {
    if (aspectRatio === '1:1') return resolution === 'sd' ? 'square' : 'square_hd';
    if (aspectRatio === '16:9') return 'landscape_16_9';
    if (aspectRatio === '9:16') return 'portrait_16_9';
    if (aspectRatio === '3:4' || aspectRatio === '4:5') return 'portrait_4_3';
    return 'landscape_4_3';
  }
  return getAspectRatioDimensions(aspectRatio, resolution);
}

export function toOpenAIImageSize(
  aspectRatio: ImageAspectRatio,
  resolution: ImageResolutionPreset,
): '1024x1024' | '1536x1024' | '1024x1536' | 'auto' {
  if (aspectRatio === '16:9') return '1536x1024';
  if (aspectRatio === '9:16') return '1024x1536';
  if (aspectRatio === '1:1') return '1024x1024';
  if (resolution === '4k') return 'auto';
  return aspectRatio === '4:5' || aspectRatio === '3:4' ? '1024x1536' : '1536x1024';
}

export function toGoogleImageSize(resolution: ImageResolutionPreset): '1K' | '2K' | '4K' {
  if (resolution === 'sd') return '1K';
  if (resolution === 'hd') return '2K';
  return '4K';
}

export function toXaiResolution(resolution: ImageResolutionPreset): '1k' | '2k' {
  return resolution === 'sd' ? '1k' : '2k';
}

export function toXaiAspectRatio(
  aspectRatio: ImageAspectRatio,
): '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '2:3' | '3:2' {
  if (aspectRatio === '4:5') return '3:4';
  return aspectRatio === '1:1' ||
    aspectRatio === '3:4' ||
    aspectRatio === '16:9' ||
    aspectRatio === '9:16'
    ? aspectRatio
    : '3:4';
}
