import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";

// Define state type for the component
export type YoutubeVideoListState = {
  highlightedId: string | null;
};

export const youtubeVideoSchema = z.object({
  id: z.string().describe("YouTube video ID"),
  title: z.string().describe("Title of the YouTube video"),
  channelTitle: z.string().describe("Title of the YouTube channel"),
  publishedAt: z.string().describe("Date when the video was published"),
  viewCount: z.string().describe("Number of views"),
  likeCount: z.string().describe("Number of likes"),
  thumbnailQuality: z
    .enum(["default", "medium", "high", "standard", "maxres"])
    .optional()
    .default("medium")
    .describe("Quality of the thumbnail image"),
});

export const youtubeVideoListSchema = z.object({
  title: z.string().optional().describe("Title displayed above the video list"),
  videos: z
    .array(youtubeVideoSchema)
    .describe("Array of YouTube videos to display"),
  columns: z
    .number()
    .optional()
    .default(3)
    .describe("Number of columns in the grid"),
  componentId: z
    .string()
    .optional()
    .default("youtube-video-list")
    .describe("Unique ID for the component state"),
});

export type YoutubeVideoProps = z.infer<typeof youtubeVideoSchema> & {
  isHighlighted: boolean;
  onHighlight: (id: string) => void;
};

export type YoutubeVideoListProps = z.infer<typeof youtubeVideoListSchema>;

export function YoutubeVideoList({
  title,
  videos,
  columns = 3,
  componentId = "youtube-video-list",
}: YoutubeVideoListProps) {
  // Initialize tambo component state for highlighting
  const [state, setState] = useTamboComponentState<YoutubeVideoListState>(
    componentId,
    { highlightedId: null }
  );

  // Handle highlighting a video
  const handleHighlightVideo = (id: string) => {
    if (!state) return;

    // If clicking the already highlighted video, unhighlight it
    if (state.highlightedId === id) {
      setState({ highlightedId: null });
    } else {
      setState({ highlightedId: id });
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      {title && <h2 className="text-2xl font-semibold mb-6">{title}</h2>}

      <div
        className="grid gap-6"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {videos.map((video, index) => (
          <YoutubeVideoPreview
            key={`${video.id}-${index}`}
            {...video}
            isHighlighted={state?.highlightedId === video.id}
            onHighlight={handleHighlightVideo}
          />
        ))}
      </div>
    </div>
  );
}

export function YoutubeVideoPreview({
  id,
  title,
  channelTitle,
  publishedAt,
  viewCount,
  likeCount,
  thumbnailQuality = "medium",
  isHighlighted,
  onHighlight,
}: YoutubeVideoProps) {
  // Generate YouTube video URL

  // Generate YouTube thumbnail URL based on quality
  const getThumbnailUrl = () => {
    return `https://img.youtube.com/vi/${id}/${thumbnailQuality}.jpg`;
  };

  // Format date to more readable format
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Format view count with commas
  const formatNumber = (numStr: string) => {
    return parseInt(numStr).toLocaleString();
  };

  return (
    <div
      className={`flex flex-col group cursor-pointer ${
        isHighlighted ? "transform scale-[1.02]" : ""
      }`}
      onClick={() => onHighlight(id)}
    >
      <div
        className={`relative block overflow-hidden rounded-lg shadow-md transition-transform duration-300 group-hover:shadow-lg ${
          isHighlighted ? "ring-2 ring-primary ring-offset-2" : ""
        }`}
      >
        {isHighlighted && (
          <div className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full font-medium">
            Selected
          </div>
        )}
        <div className="relative pt-[56.25%]">
          <img
            src={getThumbnailUrl()}
            alt={title}
            className="absolute top-0 left-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black bg-opacity-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="w-16 h-16 rounded-full bg-black bg-opacity-60 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="white"
                className="w-8 h-8"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <h3
          className={`text-lg font-medium line-clamp-2 ${
            isHighlighted ? "text-primary" : ""
          }`}
        >
          {title}
        </h3>
        <p className="text-sm text-gray-600 mt-1">{channelTitle}</p>
        <div className="flex text-xs text-gray-500 mt-1">
          <span>{formatDate(publishedAt)}</span>
          <span className="mx-2">•</span>
          <span>{formatNumber(viewCount)} views</span>
          <span className="mx-2">•</span>
          <span>{formatNumber(likeCount)} likes</span>
        </div>
      </div>
    </div>
  );
}
