import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";
import { useState, useEffect, useCallback } from "react";
import { YoutubeEmbed } from "./youtube-embed";
import { debounce } from "lodash";

// Enhanced search parameters schema
export const youtubeSearchEnhancedSchema = z.object({
  title: z.string().optional().describe("Title displayed above the search interface"),
  initialQuery: z.string().optional().describe("Initial search query"),
  autoSearch: z.boolean().optional().default(true).describe("Automatically search on mount"),
  showTranscripts: z.boolean().optional().default(true).describe("Enable transcript viewing"),
  showTrending: z.boolean().optional().default(true).describe("Show trending videos section"),
  maxResults: z.number().optional().default(20).describe("Maximum results per search"),
  componentId: z.string().optional().default("youtube-search-enhanced").describe("Unique component ID"),
});

export type YoutubeSearchEnhancedProps = z.infer<typeof youtubeSearchEnhancedSchema>;

// State type for the enhanced component
export type YoutubeSearchState = {
  searchQuery: string;
  searchResults: VideoResult[];
  trendingVideos: VideoResult[];
  selectedVideo: VideoResult | null;
  transcript: TranscriptSegment[] | null;
  loading: boolean;
  error: string | null;
  filters: SearchFilters;
  view: "search" | "trending" | "video";
};

export type VideoResult = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  thumbnail: {
    url: string;
    width: number;
    height: number;
  };
  isVerified?: boolean;
  isOfficial?: boolean;
};

export type TranscriptSegment = {
  text: string;
  start: number;
  duration: number;
};

export type SearchFilters = {
  sortBy: "relevance" | "date" | "viewCount" | "rating";
  uploadDate: "any" | "today" | "week" | "month" | "year";
  duration: "any" | "short" | "medium" | "long";
  officialOnly: boolean;
};

export function YoutubeSearchEnhanced({
  title,
  initialQuery = "",
  autoSearch = true,
  showTranscripts = true,
  showTrending = true,
  maxResults = 20,
  componentId = "youtube-search-enhanced",
}: YoutubeSearchEnhancedProps) {
  const [state, setState] = useTamboComponentState<YoutubeSearchState>(
    componentId,
    {
      searchQuery: initialQuery,
      searchResults: [],
      trendingVideos: [],
      selectedVideo: null,
      transcript: null,
      loading: false,
      error: null,
      filters: {
        sortBy: "relevance",
        uploadDate: "any",
        duration: "any",
        officialOnly: false,
      },
      view: "search",
    }
  );

  // MCP Tool execution via Tambo
  const executeMCPTool = useCallback(async (tool: string, params: any) => {
    try {
      // Send to Tambo as a formatted message that will trigger MCP tool
      const message = `Execute YouTube MCP tool: ${tool} with parameters: ${JSON.stringify(params, null, 2)}`;
      
      // Dispatch custom event that Tambo will handle
      window.dispatchEvent(
        new CustomEvent("tambo:executeMCPTool", {
          detail: {
            tool: `youtube_${tool}`,
            params,
            componentId,
          }
        })
      );

      // For now, we'll simulate the response structure
      // In production, this would come from the MCP server
      return { success: true, data: null };
    } catch (error) {
      console.error(`Error executing MCP tool ${tool}:`, error);
      return { success: false, error };
    }
  }, [componentId]);

  // Debounced search function
  const performSearch = useCallback(
    debounce(async (query: string, filters: SearchFilters) => {
      if (!query.trim() && state?.view !== "trending") return;

      setState(prev => prev ? { ...prev, loading: true, error: null } : prev);

      try {
        // Build search parameters based on filters
        const searchParams = {
          query,
          maxResults,
          order: filters.sortBy,
          publishedAfter: getPublishedAfterDate(filters.uploadDate),
          videoDuration: filters.duration !== "any" ? filters.duration : undefined,
        };

        // Execute search via MCP
        const result = await executeMCPTool("searchVideos", searchParams);

        if (result.success) {
          // Process results to identify official channels
          const processedResults = await processSearchResults(result.data || []);
          
          setState(prev => prev ? {
            ...prev,
            searchResults: processedResults,
            loading: false,
          } : prev);
        }
      } catch (error) {
        setState(prev => prev ? {
          ...prev,
          error: "Failed to search videos",
          loading: false,
        } : prev);
      }
    }, 500),
    [state?.view, maxResults, executeMCPTool, setState]
  );

  // Load trending videos
  const loadTrendingVideos = useCallback(async () => {
    if (!showTrending) return;

    try {
      const result = await executeMCPTool("getTrendingVideos", {
        maxResults: 10,
        regionCode: "US", // Can be made configurable
      });

      if (result.success && result.data) {
        setState(prev => prev ? {
          ...prev,
          trendingVideos: result.data,
        } : prev);
      }
    } catch (error) {
      console.error("Failed to load trending videos:", error);
    }
  }, [showTrending, executeMCPTool, setState]);

  // Load transcript for selected video
  const loadTranscript = useCallback(async (videoId: string) => {
    if (!showTranscripts) return;

    try {
      const result = await executeMCPTool("getTranscripts", {
        videoIds: [videoId],
        lang: "en", // Can be made configurable
      });

      if (result.success && result.data?.[0]) {
        setState(prev => prev ? {
          ...prev,
          transcript: result.data[0].segments,
        } : prev);
      }
    } catch (error) {
      console.error("Failed to load transcript:", error);
    }
  }, [showTranscripts, executeMCPTool, setState]);

  // Process search results to identify official/verified channels
  const processSearchResults = async (results: any[]): Promise<VideoResult[]> => {
    // Get channel details to verify official status
    const channelIds = [...new Set(results.map(r => r.snippet.channelId))];
    
    try {
      const channelResult = await executeMCPTool("getChannelStatistics", {
        channelIds,
      });

      const channelData = channelResult.data || {};
      
      return results.map(item => {
        const channel = channelData[item.snippet.channelId] || {};
        const isVerified = channel.subscriberCount > 100000; // Simple heuristic
        const isOfficial = item.snippet.channelTitle.includes("Official") || 
                          item.snippet.channelTitle.includes("VEVO");

        return {
          id: item.id.videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          channelTitle: item.snippet.channelTitle,
          channelId: item.snippet.channelId,
          publishedAt: item.snippet.publishedAt,
          duration: item.contentDetails?.duration || "",
          viewCount: item.statistics?.viewCount || "0",
          likeCount: item.statistics?.likeCount || "0",
          commentCount: item.statistics?.commentCount || "0",
          thumbnail: item.snippet.thumbnails.high,
          isVerified,
          isOfficial,
        };
      });
    } catch (error) {
      // Fallback without channel verification
      return results.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        publishedAt: item.snippet.publishedAt,
        duration: item.contentDetails?.duration || "",
        viewCount: item.statistics?.viewCount || "0",
        likeCount: item.statistics?.likeCount || "0",
        commentCount: item.statistics?.commentCount || "0",
        thumbnail: item.snippet.thumbnails.high,
      }));
    }
  };

  // Get published after date based on filter
  const getPublishedAfterDate = (filter: string): string | undefined => {
    const now = new Date();
    switch (filter) {
      case "today":
        return new Date(now.setDate(now.getDate() - 1)).toISOString();
      case "week":
        return new Date(now.setDate(now.getDate() - 7)).toISOString();
      case "month":
        return new Date(now.setMonth(now.getMonth() - 1)).toISOString();
      case "year":
        return new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
      default:
        return undefined;
    }
  };

  // Handle video selection
  const selectVideo = (video: VideoResult) => {
    setState(prev => prev ? {
      ...prev,
      selectedVideo: video,
      view: "video",
      transcript: null,
    } : prev);

    // Load transcript if enabled
    if (showTranscripts) {
      loadTranscript(video.id);
    }
  };

  // Navigate to timestamp in video
  const navigateToTimestamp = (seconds: number) => {
    if (!state?.selectedVideo) return;

    // Update the embedded video to start at the specified time
    window.dispatchEvent(
      new CustomEvent("youtube:seekTo", {
        detail: {
          videoId: state.selectedVideo.id,
          seconds,
        }
      })
    );
  };

  // Format duration for display
  const formatDuration = (isoDuration: string): string => {
    if (!isoDuration) return "";
    // Convert ISO 8601 duration to readable format
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return "";
    
    const hours = match[1] ? `${match[1]}:` : "";
    const minutes = match[2] ? match[2].padStart(2, "0") : "00";
    const seconds = match[3] ? match[3].padStart(2, "0") : "00";
    
    return `${hours}${minutes}:${seconds}`;
  };

  // Format view count
  const formatViewCount = (count: string): string => {
    const num = parseInt(count);
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return count;
  };

  // Initial load
  useEffect(() => {
    if (autoSearch && initialQuery) {
      performSearch(initialQuery, state?.filters || {
        sortBy: "relevance",
        uploadDate: "any",
        duration: "any",
        officialOnly: false,
      });
    }
    if (showTrending) {
      loadTrendingVideos();
    }
  }, []); // Only run once on mount

  if (!state) return null;

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {title && <h2 className="text-2xl font-bold mb-6">{title}</h2>}

      {/* Search Interface */}
      {state.view !== "video" && (
        <div className="mb-8">
          {/* Search Bar */}
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              value={state.searchQuery}
              onChange={(e) => {
                const newQuery = e.target.value;
                setState({ ...state, searchQuery: newQuery });
                performSearch(newQuery, state.filters);
              }}
              placeholder="Search YouTube videos..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => performSearch(state.searchQuery, state.filters)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Search
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-6">
            <select
              value={state.filters.sortBy}
              onChange={(e) => {
                const newFilters = { ...state.filters, sortBy: e.target.value as any };
                setState({ ...state, filters: newFilters });
                performSearch(state.searchQuery, newFilters);
              }}
              className="px-3 py-1 border border-gray-300 rounded-md"
            >
              <option value="relevance">Relevance</option>
              <option value="date">Upload Date</option>
              <option value="viewCount">View Count</option>
              <option value="rating">Rating</option>
            </select>

            <select
              value={state.filters.uploadDate}
              onChange={(e) => {
                const newFilters = { ...state.filters, uploadDate: e.target.value as any };
                setState({ ...state, filters: newFilters });
                performSearch(state.searchQuery, newFilters);
              }}
              className="px-3 py-1 border border-gray-300 rounded-md"
            >
              <option value="any">Any time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
            </select>

            <select
              value={state.filters.duration}
              onChange={(e) => {
                const newFilters = { ...state.filters, duration: e.target.value as any };
                setState({ ...state, filters: newFilters });
                performSearch(state.searchQuery, newFilters);
              }}
              className="px-3 py-1 border border-gray-300 rounded-md"
            >
              <option value="any">Any duration</option>
              <option value="short">Under 4 minutes</option>
              <option value="medium">4-20 minutes</option>
              <option value="long">Over 20 minutes</option>
            </select>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.filters.officialOnly}
                onChange={(e) => {
                  const newFilters = { ...state.filters, officialOnly: e.target.checked };
                  setState({ ...state, filters: newFilters });
                  performSearch(state.searchQuery, newFilters);
                }}
                className="rounded"
              />
              <span className="text-sm">Official channels only</span>
            </label>
          </div>

          {/* View Tabs */}
          <div className="flex gap-4 mb-6 border-b">
            <button
              onClick={() => setState({ ...state, view: "search" })}
              className={`pb-2 px-4 ${state.view === "search" ? "border-b-2 border-blue-600 font-semibold" : ""}`}
            >
              Search Results
            </button>
            {showTrending && (
              <button
                onClick={() => setState({ ...state, view: "trending" })}
                className={`pb-2 px-4 ${state.view === "trending" ? "border-b-2 border-blue-600 font-semibold" : ""}`}
              >
                Trending Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading State */}
      {state.loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Error State */}
      {state.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-700">{state.error}</p>
        </div>
      )}

      {/* Search Results Grid */}
      {state.view === "search" && !state.loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {state.searchResults.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onSelect={() => selectVideo(video)}
            />
          ))}
          {state.searchResults.length === 0 && state.searchQuery && (
            <div className="col-span-full text-center py-12 text-gray-500">
              No results found for "{state.searchQuery}"
            </div>
          )}
        </div>
      )}

      {/* Trending Videos Grid */}
      {state.view === "trending" && !state.loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {state.trendingVideos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onSelect={() => selectVideo(video)}
              showTrendingBadge
            />
          ))}
        </div>
      )}

      {/* Video Player View */}
      {state.view === "video" && state.selectedVideo && (
        <div>
          <button
            onClick={() => setState({ ...state, view: "search", selectedVideo: null, transcript: null })}
            className="mb-4 text-blue-600 hover:text-blue-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to results
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Video Player */}
            <div className="lg:col-span-2">
              <YoutubeEmbed
                videoId={state.selectedVideo.id}
                title={state.selectedVideo.title}
              />
              
              {/* Video Info */}
              <div className="mt-4">
                <h3 className="text-xl font-semibold">{state.selectedVideo.title}</h3>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                  <span>{state.selectedVideo.channelTitle}</span>
                  {state.selectedVideo.isVerified && (
                    <span className="text-blue-600">✓ Verified</span>
                  )}
                  <span>{formatViewCount(state.selectedVideo.viewCount)} views</span>
                  <span>{new Date(state.selectedVideo.publishedAt).toLocaleDateString()}</span>
                </div>
                <p className="mt-4 text-gray-700 whitespace-pre-wrap">
                  {state.selectedVideo.description}
                </p>
              </div>
            </div>

            {/* Transcript Panel */}
            {showTranscripts && (
              <div className="lg:col-span-1">
                <div className="bg-gray-50 rounded-lg p-4 max-h-[600px] overflow-y-auto">
                  <h4 className="font-semibold mb-4">Transcript</h4>
                  {state.transcript ? (
                    <div className="space-y-2">
                      {state.transcript.map((segment, index) => (
                        <div
                          key={index}
                          onClick={() => navigateToTimestamp(segment.start)}
                          className="cursor-pointer hover:bg-gray-100 p-2 rounded transition-colors"
                        >
                          <span className="text-xs text-blue-600 font-mono">
                            {formatTimestamp(segment.start)}
                          </span>
                          <p className="text-sm mt-1">{segment.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Loading transcript...</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Video Card Component
function VideoCard({ 
  video, 
  onSelect, 
  showTrendingBadge = false 
}: { 
  video: VideoResult; 
  onSelect: () => void;
  showTrendingBadge?: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className="cursor-pointer group hover:shadow-lg transition-shadow rounded-lg overflow-hidden border border-gray-200"
    >
      <div className="relative">
        <img
          src={video.thumbnail.url}
          alt={video.title}
          className="w-full aspect-video object-cover"
        />
        {showTrendingBadge && (
          <div className="absolute top-2 left-2 bg-red-600 text-white text-xs px-2 py-1 rounded">
            Trending
          </div>
        )}
        {video.isOfficial && (
          <div className="absolute top-2 right-2 bg-gray-900 text-white text-xs px-2 py-1 rounded">
            Official
          </div>
        )}
        {video.duration && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
            {formatDuration(video.duration)}
          </div>
        )}
      </div>
      
      <div className="p-4">
        <h3 className="font-medium line-clamp-2 group-hover:text-blue-600 transition-colors">
          {video.title}
        </h3>
        <div className="mt-2 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span>{video.channelTitle}</span>
            {video.isVerified && (
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span>{formatViewCount(video.viewCount)} views</span>
            <span>{formatRelativeTime(video.publishedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function formatDuration(isoDuration: string): string {
  if (!isoDuration) return "";
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  
  const hours = match[1] ? `${match[1]}:` : "";
  const minutes = match[2] ? match[2].padStart(2, "0") : "00";
  const seconds = match[3] ? match[3].padStart(2, "0") : "00";
  
  return `${hours}${minutes}:${seconds}`;
}

function formatViewCount(count: string): string {
  const num = parseInt(count);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return count;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)} months ago`;
  return `${Math.floor(diffInSeconds / 31536000)} years ago`;
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
} 