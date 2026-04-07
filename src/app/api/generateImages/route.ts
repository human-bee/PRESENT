import OpenAI from 'openai';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { resolveProviderKeyWithFallback } from '@/lib/agents/control-plane/key-resolution';
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_IMAGE_QUALITY_PRESET,
  DEFAULT_IMAGE_RESOLUTION_PRESET,
  IMAGE_ASPECT_RATIOS,
  IMAGE_MODEL_IDS,
  IMAGE_QUALITY_PRESETS,
  IMAGE_RESOLUTION_PRESETS,
  clampAspectRatio,
  clampImageCount,
  clampQualityPreset,
  clampResolutionPreset,
  getAspectRatioDimensions,
  getImageModelDefinition,
  toFalImageSize,
  toGoogleImageSize,
  toOpenAIImageSize,
  toXaiAspectRatio,
  toXaiResolution,
} from '@/lib/ai/image-models';

export const runtime = 'nodejs';

const LEGACY_IMAGE_MODEL_ALIASES: Record<string, (typeof IMAGE_MODEL_IDS)[number]> = {
  'gemini-3-pro-image-preview': 'google-nano-banana-2',
};
const LEGACY_IMAGE_FALLBACK_ORDER = [
  'google-nano-banana-2',
  'fal-flux-2-dev-flash',
  'openai-gpt-image-1_5-high',
  'xai-grok-imagine-image',
] as const;

const requestSchema = z.object({
  prompt: z.string().trim().min(1),
  iterativeMode: z.boolean().optional().default(false),
  style: z.string().optional(),
  model: z.enum(IMAGE_MODEL_IDS).optional().default(DEFAULT_IMAGE_MODEL_ID),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional().default(DEFAULT_IMAGE_ASPECT_RATIO),
  resolution: z.enum(IMAGE_RESOLUTION_PRESETS).optional().default(DEFAULT_IMAGE_RESOLUTION_PRESET),
  quality: z.enum(IMAGE_QUALITY_PRESETS).optional().default(DEFAULT_IMAGE_QUALITY_PRESET),
  imageCount: z.number().int().min(1).max(4).optional().default(1),
  useGrounding: z.boolean().optional().default(false),
});

type ImageResponse = {
  b64_json: string;
  mimeType?: string;
  timings?: { inference?: number };
  providerUsed?: string | null;
  fallbackReason?: string | null;
  modelId: string;
  modelLabel: string;
  width?: number;
  height?: number;
};

type GenerateRequest = z.infer<typeof requestSchema>;

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const readProviderErrorMessage = (payload: Record<string, unknown> | null, fallback: string): string => {
  const errorRecord = readRecord(payload?.error);
  return readString(errorRecord?.message) ?? readString(payload?.detail) ?? readString(payload?.error) ?? fallback;
};

const DEFAULT_IMAGE_MIME_TYPE = 'image/png';

const normalizeImageMimeType = (value: unknown): string =>
  typeof value === 'string' && value.startsWith('image/') ? value : DEFAULT_IMAGE_MIME_TYPE;

const readFirstArrayRecord = (value: unknown): Record<string, unknown> | null => {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return first && typeof first === 'object' && !Array.isArray(first)
    ? (first as Record<string, unknown>)
    : null;
};

const providerEnvKey = (provider: 'google' | 'openai' | 'xai' | 'fal'): string | undefined => {
  switch (provider) {
    case 'google':
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'xai':
      return process.env.XAI_API_KEY;
    case 'fal':
      return process.env.FAL_API_KEY;
  }
};

async function resolveProviderKey(
  req: NextRequest,
  provider: 'google' | 'openai' | 'xai' | 'fal',
  userId: string | null,
): Promise<string | null> {
  if (BYOK_ENABLED) {
    if (!userId) return null;
    const resolved = await resolveProviderKeyWithFallback({
      req,
      provider,
      userId,
      roomScope: req.nextUrl.searchParams.get('room'),
    });
    return resolved?.key ?? null;
  }
  return providerEnvKey(provider)?.trim() || null;
}

async function fetchAsBase64(url: string): Promise<{ b64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed_to_fetch_generated_image:${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return {
    b64: Buffer.from(bytes).toString('base64'),
    mimeType: normalizeImageMimeType(response.headers.get('content-type')),
  };
}

async function generateWithGoogle(apiKey: string, request: GenerateRequest, finalPrompt: string): Promise<ImageResponse> {
  const aspectRatio = clampAspectRatio(request.model, request.aspectRatio);
  const resolution = clampResolutionPreset(request.model, request.resolution);
  const imageCount = clampImageCount(request.model, request.imageCount);
  const prompt = [
    finalPrompt,
    `Aspect ratio: ${aspectRatio}.`,
    `Resolution target: ${toGoogleImageSize(resolution)}.`,
    imageCount > 1 ? `Return ${imageCount} image variations.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  if (request.useGrounding) {
    body.tools = [{ google_search: {} }];
  }

  let payload: Record<string, unknown> | null = null;
  let lastStatus: number | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    payload = await response.json().catch(() => null);
    if (response.ok) {
      lastStatus = response.status;
      break;
    }
    lastStatus = response.status;
    if ((response.status === 429 || response.status === 503) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      continue;
    }
    throw new Error(readProviderErrorMessage(payload, `google_image_error:${response.status}`));
  }

  if (!payload || lastStatus !== 200) {
    throw new Error('google_image_missing_payload');
  }

  const candidate = readFirstArrayRecord(payload?.candidates);
  const content = readRecord(candidate?.content);
  const imagePart =
    Array.isArray(content?.parts)
      ? content.parts.find((part) => {
          const partRecord = readRecord(part);
          const inlineData = readRecord(partRecord?.inlineData);
          return readString(inlineData?.data) !== null;
        })
      : null;
  const imagePartRecord = readRecord(imagePart);
  const inlineData = readRecord(imagePartRecord?.inlineData);
  const b64 = readString(inlineData?.data);
  if (typeof b64 !== 'string' || !b64.length) {
    throw new Error('google_image_missing_payload');
  }
  const { width, height } = getAspectRatioDimensions(aspectRatio, resolution);
  return {
    b64_json: b64,
    mimeType: DEFAULT_IMAGE_MIME_TYPE,
    timings: { inference: 0 },
    providerUsed: 'google:gemini-3.1-flash-image-preview',
    modelId: request.model,
    modelLabel: getImageModelDefinition(request.model).label,
    width,
    height,
  };
}

async function generateWithOpenAI(apiKey: string, request: GenerateRequest, finalPrompt: string): Promise<ImageResponse> {
  const aspectRatio = clampAspectRatio(request.model, request.aspectRatio);
  const resolution = clampResolutionPreset(request.model, request.resolution);
  const quality = clampQualityPreset(request.model, request.quality);
  const client = new OpenAI({ apiKey });
  const image = await client.images.generate({
    model: 'gpt-image-1.5',
    prompt: finalPrompt,
    quality: quality === 'high' ? 'high' : 'medium',
    size: toOpenAIImageSize(aspectRatio, resolution),
  });
  const b64 = image.data?.[0]?.b64_json;
  if (typeof b64 !== 'string' || !b64.length) {
    throw new Error('openai_image_missing_payload');
  }
  const { width, height } = getAspectRatioDimensions(aspectRatio, resolution);
  return {
    b64_json: b64,
    mimeType: DEFAULT_IMAGE_MIME_TYPE,
    timings: { inference: 0 },
    providerUsed: 'openai:gpt-image-1.5',
    modelId: request.model,
    modelLabel: getImageModelDefinition(request.model).label,
    width,
    height,
  };
}

async function generateWithXai(apiKey: string, request: GenerateRequest, finalPrompt: string): Promise<ImageResponse> {
  const aspectRatio = clampAspectRatio(request.model, request.aspectRatio);
  const resolution = clampResolutionPreset(request.model, request.resolution);
  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-imagine-image',
      prompt: finalPrompt,
      n: clampImageCount(request.model, request.imageCount),
      response_format: 'b64_json',
      aspect_ratio: toXaiAspectRatio(aspectRatio),
      resolution: toXaiResolution(resolution),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readProviderErrorMessage(payload, `xai_image_error:${response.status}`));
  }
  const firstImage = readFirstArrayRecord(payload?.data);
  let b64: string | null = null;
  let mimeType = DEFAULT_IMAGE_MIME_TYPE;
  const inlineB64 = readString(firstImage?.b64_json);
  const imageUrl = readString(firstImage?.url);
  if (inlineB64) {
    b64 = inlineB64;
  } else if (imageUrl) {
    const fetched = await fetchAsBase64(imageUrl);
    b64 = fetched.b64;
    mimeType = fetched.mimeType;
  }
  if (!b64) throw new Error('xai_image_missing_payload');
  const { width, height } = getAspectRatioDimensions(aspectRatio, resolution);
  return {
    b64_json: b64,
    mimeType,
    timings: { inference: 0 },
    providerUsed: 'xai:grok-imagine-image',
    modelId: request.model,
    modelLabel: getImageModelDefinition(request.model).label,
    width,
    height,
  };
}

async function generateWithFal(apiKey: string, request: GenerateRequest, finalPrompt: string): Promise<ImageResponse> {
  const aspectRatio = clampAspectRatio(request.model, request.aspectRatio);
  const resolution = clampResolutionPreset(request.model, request.resolution);
  const response = await fetch('https://fal.run/fal-ai/flux-2/flash', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: finalPrompt,
      image_size: toFalImageSize(aspectRatio, resolution),
      num_images: clampImageCount(request.model, request.imageCount),
      seed: request.iterativeMode ? 123 : undefined,
      sync_mode: true,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readProviderErrorMessage(payload, `fal_image_error:${response.status}`));
  }
  const firstImage = readFirstArrayRecord(payload?.images);
  const url = readString(firstImage?.url);
  if (typeof url !== 'string' || !url.length) {
    throw new Error('fal_image_missing_url');
  }
  const fetched = await fetchAsBase64(url);
  return {
    b64_json: fetched.b64,
    mimeType: fetched.mimeType,
    timings: { inference: 0 },
    providerUsed: 'fal:flux-2-flash',
    modelId: request.model,
    modelLabel: getImageModelDefinition(request.model).label,
    width: typeof firstImage?.width === 'number' ? firstImage.width : undefined,
    height: typeof firstImage?.height === 'number' ? firstImage.height : undefined,
  };
}

export async function POST(req: NextRequest) {
  const json = await req.json();
  const requestedModel =
    json && typeof json === 'object' && typeof (json as { model?: unknown }).model === 'string'
      ? (json as { model: string }).model
      : null;
  const isLegacyGeminiRequest = requestedModel === 'gemini-3-pro-image-preview';
  const normalizedInput =
    json && typeof json === 'object'
      ? {
          ...json,
          model:
            typeof (json as { model?: unknown }).model === 'string'
              ? (LEGACY_IMAGE_MODEL_ALIASES[(json as { model: string }).model] ??
                  (json as { model: string }).model)
              : (json as { model?: unknown }).model,
        }
      : json;
  const parsedResult = requestSchema.safeParse(normalizedInput);
  if (!parsedResult.success) {
    return NextResponse.json(
      {
        error: 'invalid_image_generation_request',
        details: parsedResult.error.flatten(),
      },
      { status: 400 },
    );
  }
  const parsed = parsedResult.data;
  const finalPrompt = parsed.style ? `${parsed.prompt}. ${parsed.style}` : parsed.prompt;

  let userId: string | null = null;
  if (BYOK_ENABLED) {
    userId = await resolveRequestUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    let effectiveModelId = parsed.model;
    let effectiveModel = getImageModelDefinition(effectiveModelId);
    let apiKey = await resolveProviderKey(req, effectiveModel.provider, userId);

    if (!apiKey && !BYOK_ENABLED && isLegacyGeminiRequest) {
      for (const candidateId of LEGACY_IMAGE_FALLBACK_ORDER) {
        const candidateModel = getImageModelDefinition(candidateId);
        const candidateKey = await resolveProviderKey(req, candidateModel.provider, userId);
        if (!candidateKey) continue;
        effectiveModelId = candidateId;
        effectiveModel = candidateModel;
        apiKey = candidateKey;
        break;
      }
    }

    if (!apiKey) {
      const prefix = BYOK_ENABLED ? 'BYOK_MISSING_KEY' : 'MISSING_PROVIDER_KEY';
      return NextResponse.json({ error: `${prefix}:${effectiveModel.provider}` }, { status: 400 });
    }

    const effectiveRequest: GenerateRequest = { ...parsed, model: effectiveModelId };
    let result: ImageResponse;
    if (effectiveModel.id === 'google-nano-banana-2') {
      result = await generateWithGoogle(apiKey, effectiveRequest, finalPrompt);
    } else if (effectiveModel.id === 'openai-gpt-image-1_5-high') {
      result = await generateWithOpenAI(apiKey, effectiveRequest, finalPrompt);
    } else if (effectiveModel.id === 'xai-grok-imagine-image') {
      result = await generateWithXai(apiKey, effectiveRequest, finalPrompt);
    } else {
      result = await generateWithFal(apiKey, effectiveRequest, finalPrompt);
    }

    if (effectiveModelId !== parsed.model) {
      result = {
        ...result,
        fallbackReason: `${requestedModel ?? parsed.model} -> ${effectiveModelId}`,
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Image generation error:', {
      model: parsed.model,
      provider: getImageModelDefinition(parsed.model).provider,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
