import { YoutubeVideoList } from "../ui/youtube-video-list";

export function YoutubeListExample() {
  const videos = [
    {
      id: "-zXMCUXBQBg",
      title: "The 50,000,000 Cookie Farm",
      channelTitle: "Yeah Jaron",
      publishedAt: "2023-05-17T12:00:00Z",
      viewCount: "427053",
      likeCount: "27574",
      thumbnailQuality: "medium" as const,
    },
    {
      id: "dQw4w9WgXcQ",
      title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      channelTitle: "Rick Astley",
      publishedAt: "2009-10-25T06:57:33Z",
      viewCount: "1419237485",
      likeCount: "14768974",
      thumbnailQuality: "medium" as const,
    },
    {
      id: "rJz_9D2AfqE",
      title: "How ChatGPT Works Technically - LLM Architecture Explained",
      channelTitle: "Tech With Tim",
      publishedAt: "2023-09-25T14:30:00Z",
      viewCount: "857346",
      likeCount: "32478",
      thumbnailQuality: "medium" as const,
    },
    {
      id: "QH2-TGUlwu4",
      title: "Nyan Cat [original]",
      channelTitle: "Nyan Cat",
      publishedAt: "2011-04-06T03:14:55Z",
      viewCount: "207654321",
      likeCount: "2345678",
      thumbnailQuality: "medium" as const,
    },
    {
      id: "rfscVS0vtbw",
      title: "Learn Python - Full Course for Beginners",
      channelTitle: "freeCodeCamp.org",
      publishedAt: "2018-07-11T16:00:00Z",
      viewCount: "45678901",
      likeCount: "867530",
      thumbnailQuality: "medium" as const,
    },
    {
      id: "bMknfKXIFA8",
      title: "React Course - Beginner's Tutorial for React JavaScript Library",
      channelTitle: "freeCodeCamp.org",
      publishedAt: "2022-01-10T17:49:14Z",
      viewCount: "3456789",
      likeCount: "98765",
      thumbnailQuality: "medium" as const,
    },
  ];

  return (
    <div className="container mx-auto py-8">
      <YoutubeVideoList title="Popular Videos" videos={videos} columns={3} />
    </div>
  );
}
