from crewai.tools import BaseTool
from typing import Dict, List, Optional, Any
import os
import logging
import sys
import traceback

class YouTubeTranscriptTool(BaseTool):
    """Tool for fetching and analyzing YouTube video transcripts."""
    
    # Properly annotate these fields with the same type as in the parent class
    name: str = "YouTube Transcript Analyzer"
    description: str = "Fetches and analyzes YouTube video transcripts to find mentions of specific topics and returns timestamps."
    
    def __init__(self):
        # Call the parent constructor with no args
        BaseTool.__init__(self)
        print("YouTubeTranscriptTool initialized")
    
    def _run(self, video_url: str, topics: List[str]) -> Dict[str, Any]:
        """
        Run the tool to analyze a YouTube video transcript.
        
        Args:
            video_url: YouTube video URL or ID
            topics: List of topics to search for in the transcript
            
        Returns:
            Dictionary with analysis results
        """
        print(f"_run method called with: video_url={video_url}, topics={topics}")
        
        try:
            # Get API key from environment variable
            api_key = os.getenv("YOUTUBE_API_KEY")
            print(f"API key found: {'Yes' if api_key else 'No'}")
            
            # Extract video ID
            video_id = self._extract_video_id(video_url)
            print(f"Extracted video ID: {video_id}")
            
            # Get video details using the YouTube Data API
            video_details = self._get_video_details(video_id, api_key)
            print(f"Video details: {video_details.get('title', 'Unknown')}")
            
            # Get transcript
            transcript = self._get_transcript(video_id)
            print(f"Transcript length: {len(transcript)}")
            
            if not transcript:
                print("No transcript found")
                return {
                    "success": False,
                    "error": "Could not retrieve transcript for this video",
                    "video_details": video_details
                }
            
            # Find topic mentions
            topic_mentions = self._find_topic_mentions(transcript, topics)
            print(f"Topic mentions: {sum(len(mentions) for mentions in topic_mentions.values())}")
            
            # Generate timestamp links
            timestamp_links = self._generate_timestamp_links(video_id, topic_mentions)
            
            # Count total mentions per topic
            mention_counts = {topic: len(mentions) for topic, mentions in topic_mentions.items()}
            print(f"Mention counts: {mention_counts}")
            
            return {
                "success": True,
                "video_details": video_details,
                "topic_mentions": topic_mentions,
                "timestamp_links": timestamp_links,
                "mention_counts": mention_counts,
                "transcript_length": len(transcript),
                "video_id": video_id,
                "video_url": f"https://www.youtube.com/watch?v={video_id}"
            }
        except Exception as e:
            print(f"Error in _run: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {
                "success": False,
                "error": f"An error occurred: {str(e)}",
                "traceback": traceback.format_exc()
            }
    
    def _extract_video_id(self, url: str) -> str:
        """Extract the video ID from a YouTube URL."""
        try:
            if "youtu.be" in url:
                return url.split("/")[-1].split("?")[0]
            elif "youtube.com/watch" in url:
                import re
                video_id_match = re.search(r'v=([^&]+)', url)
                if video_id_match:
                    return video_id_match.group(1)
            return url  # Assume it's already an ID if we can't extract it
        except Exception as e:
            print(f"Error in _extract_video_id: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return url
    
    def _get_video_details(self, video_id: str, api_key: str) -> Dict[str, Any]:
        """Get video details using YouTube Data API v3."""
        try:
            if not api_key:
                print("No API key provided")
                return {"title": "Unknown", "channel": "Unknown", "description": "No API key available"}
            
            print("Building YouTube client...")
            # Import in the method to avoid import errors
            from googleapiclient.discovery import build
            
            youtube = build('youtube', 'v3', developerKey=api_key)
            print("Fetching video details...")
            response = youtube.videos().list(
                part='snippet,contentDetails,statistics',
                id=video_id
            ).execute()
            
            if response['items']:
                item = response['items'][0]
                return {
                    'title': item['snippet']['title'],
                    'channel': item['snippet']['channelTitle'],
                    'description': item['snippet']['description'],
                    'published_at': item['snippet']['publishedAt'],
                    'duration': item['contentDetails']['duration'],
                    'view_count': item['statistics'].get('viewCount', 'N/A'),
                    'like_count': item['statistics'].get('likeCount', 'N/A')
                }
            print("No items found in the response")
            return {"title": "Unknown", "channel": "Unknown", "description": ""}
        except Exception as e:
            print(f"Error in _get_video_details: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {"title": "Unknown", "channel": "Unknown", "description": f"Error: {str(e)}"}
    
    def _get_transcript(self, video_id: str) -> List[Dict[str, Any]]:
        """Fetch transcript for a video using youtube_transcript_api."""
        try:
            print("Fetching transcript...")
            # Import in the method to avoid import errors
            from youtube_transcript_api import YouTubeTranscriptApi
            
            transcript = YouTubeTranscriptApi.get_transcript(video_id)
            print(f"Transcript successfully fetched with {len(transcript)} segments")
            return transcript
        except Exception as e:
            print(f"Error in _get_transcript: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return []
    
    def _find_topic_mentions(self, transcript: List[Dict[str, Any]], topics: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Find mentions of specified topics in the transcript."""
        try:
            print(f"Finding mentions of topics: {topics}")
            results = {topic: [] for topic in topics}
            
            for segment in transcript:
                text = segment['text'].lower()
                start_time = segment['start']
                
                for topic in topics:
                    topic_lower = topic.lower()
                    if topic_lower in text:
                        # Convert seconds to MM:SS format
                        minutes = int(start_time // 60)
                        seconds = int(start_time % 60)
                        timestamp = f"{minutes:02d}:{seconds:02d}"
                        
                        # Create YouTube timestamp link
                        youtube_timestamp = int(start_time)
                        
                        results[topic].append({
                            'timestamp': timestamp,
                            'youtube_timestamp': youtube_timestamp,
                            'time_in_seconds': start_time,
                            'text': segment['text']
                        })
            
            total_mentions = sum(len(mentions) for mentions in results.values())
            print(f"Found {total_mentions} total mentions")
            return results
        except Exception as e:
            print(f"Error in _find_topic_mentions: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {topic: [] for topic in topics}
    
    def _generate_timestamp_links(self, video_id: str, mentions: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
        """Generate clickable YouTube timestamp links for each mention."""
        try:
            print("Generating timestamp links")
            result = {}
            for topic, occurrences in mentions.items():
                result[topic] = []
                for occurrence in occurrences:
                    timestamp_seconds = int(occurrence['time_in_seconds'])
                    timestamp_link = f"https://www.youtube.com/watch?v={video_id}&t={timestamp_seconds}s"
                    
                    result[topic].append({
                        **occurrence,
                        'timestamp_link': timestamp_link
                    })
            return result
        except Exception as e:
            print(f"Error in _generate_timestamp_links: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {}