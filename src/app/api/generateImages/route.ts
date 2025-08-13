import { z } from "zod";

export async function POST(req: Request) {
  const json = await req.json();
  const { prompt, userAPIKey, iterativeMode, style } = z
    .object({
      prompt: z.string(),
      iterativeMode: z.boolean(),
      userAPIKey: z.string().nullable().optional(),
      style: z.string().optional(),
    })
    .parse(json);

  // Check for Together API key
  const apiKey = userAPIKey || process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Together AI API key is required" },
      { status: 400 }
    );
  }

  // Build the final prompt with style if provided
  let finalPrompt = prompt;
  if (style) {
    finalPrompt += `. ${style}`;
  }

  let response;
  try {
    response = await fetch("https://api.together.xyz/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: finalPrompt,
        model: "black-forest-labs/FLUX.1-schnell",
        width: 1024,
        height: 768,
        seed: iterativeMode ? 123 : undefined,
        steps: 3,
        response_format: "base64",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Return the first image data with timing info
    return Response.json({
      b64_json: data.data[0].b64_json,
      timings: { inference: 2000 }, // Placeholder timing
    });
  } catch (e: any) {
    console.error("Image generation error:", e);
    return Response.json(
      { error: e.toString() },
      { status: 500 }
    );
  }
}

export const runtime = "edge"; 