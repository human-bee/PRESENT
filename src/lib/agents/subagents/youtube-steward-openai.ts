import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

const youtubeActionSchema = z.object({
  kind: z.enum(['search', 'getVideo', 'getChannel', 'getTrending', 'embed', 'noOp']),
  videoId: z.string().optional(),
  channelId: z.string().optional(),
  reason: z.string().optional(),
  mcpTool: z
    .object({
      name: z.string().min(1),
      args: z.record(z.unknown()).default({}),
    })
    .nullable(),
});

export type YouTubeAction = z.infer<typeof youtubeActionSchema> & {
  mcpTool: { name: string; args: Record<string, unknown> } | null;
};

const YOUTUBE_SYSTEM = `
You are a YouTube assistant that maps user requests to YouTube MCP tool calls.

Available YouTube MCP Tools:
- searchVideos: { query, maxResults?, order? }
- getVideoDetails: { videoId }
- getChannelVideos: { channelId, maxResults? }
- getTrending: { categoryId?, regionCode? }

Rules:
1. Parse the user's intent and map to the appropriate tool.
2. For "latest/newest", prefer order="date".
3. For "popular/best", prefer order="viewCount".
4. Output STRICT JSON matching the schema (no markdown).
`;

const unsafeGenerateObject = generateObject as unknown as (args: any) => Promise<{ object: any }>;

export async function runYouTubeStewardOpenAI(params: {
  instruction: string;
  context?: any;
  openaiApiKey: string;
}): Promise<YouTubeAction> {
  const instruction = String(params.instruction || '').trim();
  if (!instruction) {
    return { kind: 'noOp', reason: 'Missing instruction', mcpTool: null };
  }

  const contextInfo = params.context?.currentVideo
    ? `Current video: ${params.context.currentVideo.title} (${params.context.currentVideo.videoId})`
    : '';

  const prompt = `${contextInfo}\n\nInstruction: "${instruction}"\n\nReturn STRICT JSON for the action.`;

  const openai = createOpenAI({ apiKey: params.openaiApiKey });
  const model = openai('gpt-5-mini');

  const { object } = await unsafeGenerateObject({
    model,
    system: YOUTUBE_SYSTEM,
    prompt,
    schema: youtubeActionSchema,
    temperature: 0,
    maxOutputTokens: 600,
  });

  const parsed = youtubeActionSchema.parse(object);
  return { ...parsed, mcpTool: parsed.mcpTool ?? null };
}

