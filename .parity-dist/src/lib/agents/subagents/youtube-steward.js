import { Agent, run } from '@openai/agents';
export const youtubeSteward = new Agent({
    name: 'YouTubeSteward',
    model: 'gpt-5-mini',
    instructions: 'Search and select helpful official videos using hosted tools, then yield a create_component call for YouTubeEmbed via the caller.',
    tools: [],
});
export async function runYouTubeSteward(params) {
    const prompt = `Find an official YouTube video for: ${params.query}`;
    const result = await run(youtubeSteward, prompt);
    return result.finalOutput;
}
//# sourceMappingURL=youtube-steward.js.map