"use client";
import * as React from "react";

export interface CrewAIYouTubeResultProps {
  results: {
    video_details: Record<string, any>;
    mention_counts: Record<string, number>;
    timestamp_links?: Record<string, any>;
    topic_mentions?: Record<string, any>;
    transcript_length?: number;
    video_id?: string;
    video_url?: string;
    success?: boolean;
    error?: string;
  };
  status: string;
}

export const CrewAIYouTubeResult: React.FC<CrewAIYouTubeResultProps> = ({ results, status }) => {
  const { video_details, mention_counts } = results;
  return (
    <div className="p-4 bg-gray-50 rounded-md border">
      <h2 className="text-xl font-semibold mb-2">YouTube Analysis Result</h2>
      <p className="mb-2"><strong>Status:</strong> {status}</p>
      <div className="mb-4">
        <h3 className="font-medium">Video Details</h3>
        <pre className="bg-white p-2 rounded overflow-auto"><code>{JSON.stringify(video_details, null, 2)}</code></pre>
      </div>
      <div>
        <h3 className="font-medium">Mention Counts</h3>
        <pre className="bg-white p-2 rounded overflow-auto"><code>{JSON.stringify(mention_counts, null, 2)}</code></pre>
      </div>
    </div>
  );
}; 