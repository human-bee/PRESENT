import { z } from "zod";

export const youtubeEmbedSchema = z.object({
  title: z.string().optional().describe("Title displayed above the embed"),
  videoId: z.string().describe("YouTube video ID"),
  startTime: z.number().optional().describe("Start time in seconds"),
});

export type YoutubeEmbedProps = z.infer<typeof youtubeEmbedSchema>;

export function YoutubeEmbed({ title, videoId, startTime }: YoutubeEmbedProps) {
  // Build YouTube embed URL with parameters
  const getEmbedUrl = (): string => {
    const params = new URLSearchParams();
    if (startTime) params.append("start", startTime.toString());

    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {title && <h3 className="text-xl font-semibold mb-4">{title}</h3>}

      <div className="w-full relative" style={{ width: "100%" }}>
        <div style={{ paddingBottom: "56.25%" }} className="relative">
          <iframe
            src={getEmbedUrl()}
            className="absolute top-0 left-0 w-full h-full border-0 rounded-md shadow-md"
            title={title || "YouTube video player"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      </div>
    </div>
  );
}
