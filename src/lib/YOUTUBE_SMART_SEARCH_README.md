# Smart YouTube Search Backend

## Overview

The YouTube search has been enhanced to automatically pick the best video and embed it directly on the canvas, just like before, but now with intelligent filtering.

## How It Works

When a user says something like "Show me the latest Pink Pantheress video", the system:

1. **Voice Agent** detects YouTube intent and calls `youtube_search` tool
2. **ToolDispatcher** receives the request and analyzes the query for:
   - Time preferences (latest, newest, recent → last 7 days)
   - Quality signals (official, VEVO → verified channels)
   - Artist/channel names for special handling
3. **Enhanced Message** is sent to custom with instructions to:
   - Use the YouTube MCP tool with smart parameters
   - Filter results based on detected preferences
   - Pick the single best video
   - Create a `YoutubeEmbed` component (not a search UI)

## Example Flow

**User says:** "Show me the latest Pink Pantheress video"

**System interprets:**

- Query: "Pink Pantheress"
- Wants: Latest video (sort by date, last 7 days)
- Channel: Look for official "Pinkpantheress" channel

**custom receives:**

```
Use the YouTube MCP tool to search for: "Pink Pantheress latest video"
- Sort by upload date (newest first)
- Prioritize videos from the last 7 days
- Get at least 5 results to choose from

After getting results:
1. Pick the most relevant video (considering recency and channel authority)
2. Create a YoutubeEmbed component with that video
3. Set the title to the video's title

Note: Look for videos from the official "Pinkpantheress" channel
```

**Result:** A single `YoutubeEmbed` component appears on canvas with the newest official video

## Smart Query Detection

### Time-based Keywords

- "latest", "newest", "recent", "new" → Sort by date, prioritize last 7 days

### Quality Keywords  

- "official", "vevo" → Filter for verified/official channels
- Known artists get special handling (e.g., "Pinkpantheress" → "Pinkpantheress" channel)

### Default Behavior

- Without keywords, searches normally but still picks single best result
- Always creates `YoutubeEmbed`, never a search UI

## Benefits

1. **Zero UI Overhead** - User gets the video immediately, no search interface
2. **Smart Filtering** - Automatically avoids re-uploads, low quality content
3. **Artist Awareness** - Knows official channels for popular artists
4. **Time Aware** - "Latest" actually means latest, not just popular
5. **Voice Optimized** - Natural language like "play the newest..." just works

## Testing

Try these voice commands:

- "Show me the latest React tutorial"
- "Play Taylor Swift's newest official video"
- "Find the latest TypeScript features video"
- "Show Pink Pantheress latest song"

Each should result in a single, high-quality video embed appearing on the canvas.
