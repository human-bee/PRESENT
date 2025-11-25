import { z } from 'zod';

export async function POST(req: Request) {
  const json = await req.json();
  const { prompt, userAPIKey, iterativeMode, style, model } = z
    .object({
      prompt: z.string(),
      iterativeMode: z.boolean(),
      userAPIKey: z.string().nullable().optional(),
      style: z.string().optional(),
      model: z.string().optional(),
    })
    .parse(json);

  // Check for Together API key
  const apiKey = userAPIKey || process.env.TOGETHER_API_KEY;

  // Build the final prompt with style if provided
  let finalPrompt = prompt;
  if (style) {
    finalPrompt += `. ${style}`;
  }

  let response;
  try {
    const requestModel = (json as any).model;
    let geminiError = null;

    if (requestModel === 'gemini-3-pro-image-preview') {
      try {
        // Prefer GEMINI_API_KEY (Google AI Studio) if available, otherwise fallback to Vertex AI
        const geminiApiKey = process.env.GEMINI_API_KEY;

        if (geminiApiKey) {
          // Google AI Studio API Logic
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiApiKey}`;

          const requestBody: any = {
            contents: [
              {
                role: 'user',
                parts: [{ text: finalPrompt }],
              },
            ],
            generationConfig: {
              responseModalities: ['IMAGE'],
              responseMimeType: 'image/png',
              imageConfig: { aspectRatio: '3:4' },
            },
          };

          // Add grounding if requested
          if ((json as any).useGrounding) {
            requestBody.tools = [{
              google_search: {}
            }];
          }

          let lastError;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              });

              if (response.ok) break;

              const errorText = await response.text();
              if (response.status === 503) {
                const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, 16s
                console.warn(`Gemini API 503 (Attempt ${attempt + 1}/5): ${errorText}. Retrying in ${waitTime}ms...`);
                if (attempt < 4) {
                  await new Promise(resolve => setTimeout(resolve, waitTime));
                  continue;
                }
              }

              throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
            } catch (e) {
              lastError = e;
              if (attempt === 4) throw e;
              if (attempt < 4) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }

          const genData = await response.json();
          const base64Image = genData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

          if (!base64Image) {
            console.error('Gemini API Response:', JSON.stringify(genData, null, 2));
            throw new Error(`No image data returned from Gemini API. Response: ${JSON.stringify(genData)}`);
          }

          return Response.json({
            b64_json: base64Image,
            timings: { inference: 0 },
          });
        }

        // Fallback to Vertex AI Logic if no GEMINI_API_KEY
        const projectId = process.env.GOOGLE_VERTEX_PROJECT_ID;
        const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
        const googleAccessToken = process.env.GOOGLE_ACCESS_TOKEN;

        if (!projectId || !googleAccessToken) {
          throw new Error('Missing Google credentials. Set GEMINI_API_KEY or (GOOGLE_VERTEX_PROJECT_ID + GOOGLE_ACCESS_TOKEN)');
        }

        const generateContentEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-3-pro-image-preview:generateContent`;

        const requestBody: any = {
          contents: [
            {
              role: 'USER',
              parts: [{ text: finalPrompt }],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
            responseMimeType: 'image/png',
            imageConfig: { aspectRatio: '3:4' },
          },
        };

        // Add grounding if requested
        if ((json as any).useGrounding) {
          requestBody.tools = [{
            google_search: {}
          }];
        }

        let lastError;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            response = await fetch(generateContentEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${googleAccessToken}`,
                'Content-Type': 'application/json; charset=utf-8',
              },
              body: JSON.stringify(requestBody),
            });

            if (response.ok) break;

            const errorText = await response.text();
            if (response.status === 503) {
              const waitTime = Math.pow(2, attempt) * 1000;
              console.warn(`Vertex AI 503 (Attempt ${attempt + 1}/5): ${errorText}. Retrying in ${waitTime}ms...`);
              if (attempt < 4) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
              }
            }

            throw new Error(`Vertex AI Error: ${response.status} - ${errorText}`);
          } catch (e) {
            lastError = e;
            if (attempt === 4) throw e;
            if (attempt < 4) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }

        const genData = await response.json();
        const base64Image = genData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (!base64Image) {
          console.error('Vertex AI Response:', JSON.stringify(genData, null, 2));
          throw new Error(`No image data returned from Vertex AI. Response: ${JSON.stringify(genData)}`);
        }

        return Response.json({
          b64_json: base64Image,
          timings: { inference: 0 },
        });

      } catch (e: any) {
        console.warn('Gemini/Vertex generation failed, falling back to Together AI:', e);
        geminiError = e;
        // Fall through to Together AI logic
      }
    }

    // Default / Fallback to Together AI (FLUX)
    if (!apiKey) {
      if (geminiError) {
        throw geminiError; // Re-throw Gemini error if we can't fallback
      }
      return Response.json({ error: 'Together AI API key is required' }, { status: 400 });
    }

    console.log('Using Together AI (Flux) fallback...');
    response = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: finalPrompt,
        model: 'black-forest-labs/FLUX.1-schnell',
        width: 1024,
        height: 768,
        seed: iterativeMode ? 123 : undefined,
        steps: 3,
        response_format: 'base64',
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
    console.error('Image generation error:', e);
    return Response.json({ error: e.toString() }, { status: 500 });
  }
}

export const runtime = 'edge';
