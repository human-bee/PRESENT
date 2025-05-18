from crewai.tools import BaseTool
from typing import Dict, List, Optional, Any, Union
import os
import logging
import sys
import traceback
import json
import requests

class EnhancedYouTubeTranscriptTool(BaseTool):
    """Tool for searching, fetching and analyzing YouTube video transcripts."""
    
    name: str = "Enhanced YouTube Analyzer"
    description: str = "Searches for YouTube videos based on a query, then fetches and analyzes their transcripts to find mentions of specific topics."
    
    def __init__(self):
        # Call the parent constructor with no args
        BaseTool.__init__(self)
        
        # Get API keys from environment variables
        self.youtube_api_key = os.getenv("YOUTUBE_API_KEY")
        self.serper_api_key = os.getenv("SERPER_API_KEY")
        
        if not self.youtube_api_key:
            logging.warning("YouTube API key not found in environment variables")
        
        if not self.serper_api_key:
            logging.warning("Serper API key not found in environment variables")
        
        print("EnhancedYouTubeTranscriptTool initialized")
    
    def _run(self, query: Optional[str] = None, video_url: Optional[str] = None, topics: List[str] = None) -> Dict[str, Any]:
        """
        Run the tool to search for videos, fetch and analyze YouTube video transcripts.
        
        Args:
            query: Search query to find YouTube videos (e.g., "Sam Altman talking about peanuts")
            video_url: Direct YouTube video URL or ID (optional, overrides query)
            topics: List of topics to search for in the transcript
            
        Returns:
            Dictionary with analysis results
        """
        print(f"_run method called with: query={query}, video_url={video_url}, topics={topics}")
        
        if not topics:
            topics = []
            print("No topics provided, will extract key points from transcript")
        
        try:
            # If video_url is not provided, search for videos based on query
            if not video_url and query:
                print(f"Searching for videos matching query: {query}")
                search_results = self._search_videos(query)
                
                if not search_results or "videos" not in search_results or len(search_results["videos"]) == 0:
                    return {
                        "success": False,
                        "error": f"No videos found for query: {query}"
                    }
                
                # Use the first video from search results
                first_video = search_results["videos"][0]
                video_url = first_video["link"]
                print(f"Selected video: {first_video.get('title', 'Unknown')} - {video_url}")
                
                # If no specific topics provided, extract key topics from the video title/description
                if not topics:
                    topics = self._extract_key_topics(first_video)
                    print(f"Extracted topics from video: {topics}")
            
            if not video_url:
                return {
                    "success": False,
                    "error": "No video URL provided and no search query specified"
                }
            
            # Extract video ID
            video_id = self._extract_video_id(video_url)
            print(f"Extracted video ID: {video_id}")
            
            # Get video details
            video_details = self._get_video_details(video_id, self.youtube_api_key)
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
            
            # If still no topics (like when direct video_url was provided), extract from video details
            if not topics:
                topics = self._extract_key_topics_from_details(video_details)
                print(f"Extracted topics from video details: {topics}")
            
            # Find topic mentions
            topic_mentions = self._find_topic_mentions(transcript, topics)
            print(f"Topic mentions: {sum(len(mentions) for mentions in topic_mentions.values())}")
            
            # Generate timestamp links
            timestamp_links = self._generate_timestamp_links(video_id, topic_mentions)
            
            # Count total mentions per topic
            mention_counts = {topic: len(mentions) for topic, mentions in topic_mentions.items()}
            print(f"Mention counts: {mention_counts}")
            
            # Generate a summary of the video
            summary = self._generate_summary(transcript)
            
            return {
                "success": True,
                "video_details": video_details,
                "topic_mentions": topic_mentions,
                "timestamp_links": timestamp_links,
                "mention_counts": mention_counts,
                "transcript_length": len(transcript),
                "video_id": video_id,
                "video_url": f"https://www.youtube.com/watch?v={video_id}",
                "summary": summary
            }
        except Exception as e:
            print(f"Error in _run: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {
                "success": False,
                "error": f"An error occurred: {str(e)}",
                "traceback": traceback.format_exc()
            }
    
    def _search_videos(self, query: str) -> Dict[str, Any]:
        """Search for YouTube videos using Serper API."""
        try:
            if not self.serper_api_key:
                print("Serper API key not found, falling back to YouTube API")
                return self._search_videos_youtube_api(query)
            
            print(f"Searching for videos with Serper API: {query}")
            url = "https://google.serper.dev/videos"
            payload = json.dumps({
                "q": query + " youtube",
                "gl": "us",
                "hl": "en",
                "num": 5
            })
            headers = {
                'X-API-KEY': self.serper_api_key,
                'Content-Type': 'application/json'
            }
            
            response = requests.request("POST", url, headers=headers, data=payload)
            
            if response.status_code == 200:
                data = response.json()
                print(f"Search returned {len(data.get('videos', []))} results")
                return data
            else:
                print(f"Serper API request failed: {response.status_code} - {response.text}")
                # Fall back to YouTube API if Serper fails
                return self._search_videos_youtube_api(query)
        except Exception as e:
            print(f"Error in _search_videos: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            # Fall back to YouTube API if exception occurs
            return self._search_videos_youtube_api(query)
    
    def _search_videos_youtube_api(self, query: str) -> Dict[str, Any]:
        """Search for YouTube videos using YouTube Data API as fallback."""
        try:
            if not self.youtube_api_key:
                print("YouTube API key not found, cannot search for videos")
                return {"videos": []}
            
            print(f"Searching for videos with YouTube API: {query}")
            from googleapiclient.discovery import build
            
            youtube = build('youtube', 'v3', developerKey=self.youtube_api_key)
            response = youtube.search().list(
                q=query,
                part='snippet',
                type='video',
                maxResults=5
            ).execute()
            
            videos = []
            for item in response.get('items', []):
                video_id = item['id']['videoId']
                videos.append({
                    'title': item['snippet']['title'],
                    'link': f"https://www.youtube.com/watch?v={video_id}",
                    'description': item['snippet']['description'],
                    'thumbnail': item['snippet']['thumbnails']['default']['url'],
                    'channel': item['snippet']['channelTitle'],
                    'publishedDate': item['snippet']['publishedAt']
                })
            
            print(f"Search returned {len(videos)} results")
            return {"videos": videos}
        except Exception as e:
            print(f"Error in _search_videos_youtube_api: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {"videos": []}
    
    def _extract_key_topics(self, video_data: Dict[str, Any]) -> List[str]:
        """Extract key topics from video search result."""
        topics = []
        
        # Extract words from title
        if "title" in video_data:
            title = video_data["title"]
            # Remove common words and split into topics
            import re
            words = re.findall(r'\b\w+\b', title.lower())
            # Filter out common words
            common_words = {'the', 'and', 'or', 'of', 'to', 'a', 'in', 'for', 'on', 'with', 'by', 'at', 'from'}
            topics = [word for word in words if word not in common_words and len(word) > 3]
        
        # Add words from description if available
        if "description" in video_data and video_data["description"]:
            # Extract key phrases from description
            import re
            phrases = re.findall(r'\b\w+(?:\s+\w+){0,2}\b', video_data["description"].lower())
            # Add longer phrases that aren't just common words
            for phrase in phrases:
                if len(phrase) > 5 and all(word not in common_words for word in phrase.split()):
                    topics.append(phrase)
        
        # Limit to 5 most relevant topics
        topics = list(set(topics))[:5]
        
        # If no topics found, use some default topics
        if not topics:
            # Extract potential name from query or use generic topics
            if "title" in video_data:
                import re
                names = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', video_data["title"])
                topics = names if names else ["important", "highlights", "key points"]
        
        return topics
    
    def _extract_key_topics_from_details(self, video_details: Dict[str, Any]) -> List[str]:
        """Extract key topics from video details."""
        topics = []
        
        # Extract words from title
        if "title" in video_details:
            title = video_details["title"]
            # Remove common words and split into topics
            import re
            words = re.findall(r'\b\w+\b', title.lower())
            # Filter out common words
            common_words = {'the', 'and', 'or', 'of', 'to', 'a', 'in', 'for', 'on', 'with', 'by', 'at', 'from'}
            topics = [word for word in words if word not in common_words and len(word) > 3]
        
        # Add words from description if available
        if "description" in video_details and video_details["description"]:
            # Extract key phrases from description
            import re
            phrases = re.findall(r'\b\w+(?:\s+\w+){0,2}\b', video_details["description"].lower())
            # Add longer phrases that aren't just common words
            for phrase in phrases:
                if len(phrase) > 5 and all(word not in common_words for word in phrase.split()):
                    topics.append(phrase)
        
        # Limit to 5 most relevant topics
        topics = list(set(topics))[:5]
        
        # If no topics found, use some default topics
        if not topics:
            topics = ["important", "highlights", "key points", "main", "conclusion"]
        
        return topics
    
    def _generate_summary(self, transcript: List[Dict[str, Any]]) -> str:
        """Generate a summary of the video transcript."""
        # Simple summary approach: take segments at regular intervals
        if len(transcript) <= 5:
            combined_text = " ".join([segment["text"] for segment in transcript])
            return combined_text
        
        # Take beginning, middle and end segments
        beginning = " ".join([segment["text"] for segment in transcript[:2]])
        middle_idx = len(transcript) // 2
        middle = " ".join([segment["text"] for segment in transcript[middle_idx:middle_idx+1]])
        end = " ".join([segment["text"] for segment in transcript[-2:]])
        
        return f"Beginning: {beginning}\n\nMiddle: {middle}\n\nEnd: {end}"
    
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