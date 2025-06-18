import { z } from "zod";
import { useState, useEffect } from "react";

export const youtubeEmbedSchema = z.object({
  title: z.string().optional().describe("Title displayed above the embed"),
  videoId: z.string().describe("YouTube video ID"),
  startTime: z.number().optional().describe("Start time in seconds"),
});

export type YoutubeEmbedProps = z.infer<typeof youtubeEmbedSchema>;

export function YoutubeEmbed({ title, videoId, startTime }: YoutubeEmbedProps) {
  const [mcpError, setMcpError] = useState<string | null>(null);

  // Error boundary for MCP transport issues
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.message?.includes('Transport is closed')) {
        console.warn('[YouTube Embed] MCP transport error detected, component will work with reduced functionality');
        setMcpError('Connection to external services temporarily unavailable');
        event.preventDefault(); // Prevent the error from bubbling up
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  // Build YouTube embed URL with parameters
  const getEmbedUrl = (): string => {
    const params = new URLSearchParams();
    if (startTime) params.append("start", startTime.toString());

    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {title && <h3 className="text-xl font-semibold mb-4">{title}</h3>}
      
      {mcpError && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                {mcpError}
              </p>
            </div>
          </div>
        </div>
      )}

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
