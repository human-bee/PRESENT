/**
 * Enhanced YouTube Agent Prompts
 *
 * This file contains intelligent prompt engineering for the YouTube MCP integration
 * to make custom smarter at finding, analyzing, and presenting YouTube content.
 */

import { getPrompt } from './prompt-loader';

export const YOUTUBE_SEARCH_PROMPTS = {
  // Smart search interpretation
  searchInterpretation: (userQuery: string) => `
Analyze this user query for YouTube search: "${userQuery}"

Extract and return:
1. Core search terms
2. Time preferences (latest, newest, recent, today, this week, etc.)
3. Quality signals (official, verified, high quality, popular)
4. Content type (tutorial, music video, podcast, livestream, etc.)
5. Duration preferences (short, long, specific length)
6. Any specific channels or creators mentioned

If the user asks for "latest" or "newest", prioritize:
- Videos from the last 7 days
- Official/verified channels
- High view-to-like ratios
- Avoid re-uploads or low-quality content

Return a structured search strategy.
`,

  // Quality analysis
  videoQualityAnalysis: async () => await getPrompt('videoQualityAnalysis'),

  // Transcript navigation
  transcriptAnalysis: (_transcript: string, userIntent: string) => `
Analyze this video transcript to find moments related to: "${userIntent}"

For each relevant segment:
1. Identify the timestamp
2. Summarize what's discussed
3. Rate relevance (1-5)
4. Note any key terms or concepts

Return the top 5 most relevant moments with timestamps.
`,

  // Content recommendation
  intelligentRecommendation: (context: string) => `
Based on the context: "${context}"

Recommend YouTube content that would be most valuable:
1. Consider the user's apparent expertise level
2. Prefer recent content (last 30 days) for technical topics
3. Prioritize comprehensive tutorials for learning
4. Include diverse perspectives from multiple creators
5. Balance entertainment value with educational content

For each recommendation, explain WHY it's relevant.
`,

  // Voice command interpretation
  voiceCommandInterpretation: (voiceInput: string) => `
Interpret this voice command for YouTube: "${voiceInput}"

Common patterns to handle:
- "Show me the latest..." → Sort by upload date, last 7 days
- "Find official..." → Filter for verified/official channels only
- "Skip to the part about..." → Navigate transcript to specific topic
- "What's trending in..." → Get trending videos for category
- "Compare videos about..." → Find multiple perspectives on topic

Return the appropriate YouTube MCP tool call with parameters.
`,
};

export const YOUTUBE_RESPONSE_TEMPLATES = {
  // Presenting search results
  searchResultsPresentation: (results: any[], query: string) => `
I found ${results.length} high-quality videos about "${query}". Here are the best matches:

${results
      .slice(0, 5)
      .map(
        (video, i) => `
${i + 1}. **${video.title}**
   📺 ${video.channelTitle} ${video.isVerified ? '✓' : ''} ${video.isOfficial ? '(Official)' : ''}
   👁️ ${formatViewCount(video.viewCount)} views • ${formatRelativeTime(video.publishedAt)}
   ${video.qualityScore >= 4 ? '⭐ High Quality Content' : ''}
   ${video.duration ? `⏱️ ${formatDuration(video.duration)}` : ''}
`,
      )
      .join('\n')}

Would you like me to play any of these or search for something more specific?
`,

  // Transcript moment presentation
  transcriptMomentPresentation: (moments: any[]) => `
I found these relevant moments in the video:

${moments
      .map(
        (moment) => `
**${formatTimestamp(moment.start)}** - ${moment.summary}
${moment.relevance >= 4 ? '🎯 Highly relevant' : ''}
`,
      )
      .join('\n\n')}

Click any timestamp to jump directly to that part of the video.
`,

  // Trending content presentation
  trendingPresentation: (videos: any[], category?: string) => `
Here's what's trending ${category ? `in ${category}` : 'on YouTube'} right now:

${videos
      .slice(0, 5)
      .map(
        (video, i) => `
${i + 1}. 🔥 **${video.title}**
   ${video.channelTitle} • ${formatViewCount(video.viewCount)} views
   📈 Trending #${i + 1} ${category ? `in ${category}` : ''}
`,
      )
      .join('\n')}

These videos are gaining rapid popularity today!
`,
};

// Helper functions for formatting
function formatViewCount(count: string): string {
  const num = parseInt(count, 10);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return count;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

  if (diffInHours < 1) return 'just now';
  if (diffInHours < 24) return `${diffInHours} hours ago`;
  if (diffInHours < 48) return 'yesterday';
  if (diffInHours < 168) return `${Math.floor(diffInHours / 24)} days ago`;
  if (diffInHours < 720) return `${Math.floor(diffInHours / 168)} weeks ago`;
  return `${Math.floor(diffInHours / 720)} months ago`;
}

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';

  const hours = match[1] ? `${match[1]}:` : '';
  const minutes = match[2] ? match[2].padStart(2, '0') : '00';
  const seconds = match[3] ? match[3].padStart(2, '0') : '00';

  return `${hours}${minutes}:${seconds}`;
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Export smart search strategies
export const SMART_SEARCH_STRATEGIES = {
  findLatestTutorials: (topic: string) => ({
    query: topic,
    order: 'date',
    publishedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    videoDuration: 'medium',
    relevanceLanguage: 'en',
  }),

  findOfficialContent: (artist: string) => ({
    query: `${artist} official`,
    order: 'relevance',
    channelType: 'show',
    safeSearch: 'moderate',
  }),

  findTrendingInCategory: (category: string) => ({
    chart: 'mostPopular',
    videoCategoryId: getCategoryId(category),
    regionCode: 'US',
    maxResults: 25,
  }),

  findEducationalContent: (subject: string) => ({
    query: `${subject} explained tutorial course`,
    order: 'viewCount',
    videoDuration: 'medium,long',
    videoDefinition: 'high',
  }),
};

function getCategoryId(category: string): string {
  const categoryMap: Record<string, string> = {
    music: '10',
    gaming: '20',
    education: '27',
    science: '28',
    technology: '28',
    howto: '26',
    entertainment: '24',
    news: '25',
    sports: '17',
    travel: '19',
  };

  return categoryMap[category.toLowerCase()] || '0';
}
