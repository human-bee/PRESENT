from crewai.tools import BaseTool
from typing import Dict, List, Optional, Any
import os
import logging
import sys
import traceback
import json
import requests
import re

# Import the existing YouTubeTranscriptTool functionality
try:
    from present.tools.youtube_tool import YouTubeTranscriptTool
except ImportError:
    # Try relative import if the absolute import fails
    try:
        from .youtube_tool import YouTubeTranscriptTool
    except ImportError:
        print("Warning: Could not import YouTubeTranscriptTool")

class EnhancedYouTubeTool(BaseTool):
    """
    Tool for finding and analyzing YouTube videos using Perplexity for search and 
    YouTube transcript analysis for content analysis.
    """
    
    name: str = "Enhanced YouTube Analyzer"
    description: str = "Finds relevant YouTube videos for a topic using Perplexity API, then analyzes their transcripts for mentions of specific topics."
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        print("EnhancedYouTubeTool initialized")
    
    def _run(self, query: str, topics: List[str] = None, limit: int = 3, mode: str = "concise") -> Dict[str, Any]:
        """
        Run the tool to find and analyze YouTube videos.
        
        Args:
            query: The description of video content to search for (e.g., "Sam Altman eating peanuts")
            topics: Optional list of topics to analyze in the transcript (defaults to keywords from query)
            limit: Maximum number of videos to analyze (default 3)
            mode: Research mode - 'concise' for short summaries or 'detailed' for in-depth research
            
        Returns:
            Dictionary with search and analysis results
        """
        print(f"Enhanced YouTube Analyzer called with: query='{query}', topics={topics}, limit={limit}")
        
        try:
            # If no topics provided, extract them from the query
            if not topics:
                topics = self._extract_topics(query)
                print(f"Extracted topics from query: {topics}")
            
            # Step 1: Use Perplexity to find relevant YouTube videos
            videos = self._find_videos(query, limit, mode)
            
            if not videos or not videos.get("success", False):
                return {
                    "success": False,
                    "error": videos.get("error", "Failed to find relevant videos"),
                    "query": query
                }
            
            # Step 2: Analyze each video's transcript
            results = []
            for video in videos.get("videos", []):
                video_id = video.get("video_id")
                if not video_id:
                    continue
                    
                print(f"Analyzing transcript for video: {video_id}")
                transcript_results = self._analyze_transcript(video_id, topics)
                
                # Combine video info with transcript analysis
                results.append({
                    "video_info": video,
                    "transcript_analysis": transcript_results
                })
            
            return {
                "success": True,
                "query": query,
                "topics_analyzed": topics,
                "videos_found": len(videos.get("videos", [])),
                "videos_analyzed": len(results),
                "results": results
            }
                
        except Exception as e:
            print(f"Error in EnhancedYouTubeTool._run: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {
                "success": False,
                "error": f"An error occurred: {str(e)}",
                "traceback": traceback.format_exc()
            }
    
    def _extract_topics(self, query: str) -> List[str]:
        """Extract key topics from the query to use for transcript analysis"""
        # Remove common words and extract likely keywords
        common_words = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'about', 'is', 'are']
        words = query.lower().split()
        topics = [word for word in words if word not in common_words and len(word) > 3]
        
        # Ensure we have at least some topics
        if not topics and words:
            topics = [words[0]]  # Use first word if no others qualify
            
        return topics[:5]  # Limit to 5 topics
    
    def _find_videos(self, query: str, limit: int, mode: str) -> Dict[str, Any]:
        """Use Perplexity API to find relevant YouTube videos based on the query"""
        try:
            # Get API key from environment variable
            api_key = os.getenv("PERPLEXITY_API_KEY")
            print(f"Perplexity API key found: {'Yes' if api_key else 'No'}")
            
            if not api_key:
                return {
                    "success": False,
                    "error": "No Perplexity API key found. Please set the PERPLEXITY_API_KEY environment variable."
                }
            
            # Prepare the search query specifically for YouTube videos
            search_query = f"Find {limit} YouTube videos about {query}. For each video return the title, channel, video URL, and a brief description. Format as a list with video URLs."
            
            # Prepare the API request
            url = "https://api.perplexity.ai/chat/completions"
            
            # Configure model and settings
            model = "sonar-medium-online" if mode == "concise" else "sonar-large-online"
            
            # Prepare the request payload according to Perplexity API specs
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a research assistant that finds relevant YouTube videos. Respond with accurate information and proper YouTube URLs for each video found."
                    },
                    {
                        "role": "user",
                        "content": search_query
                    }
                ],
                "max_tokens": 2048,
                "temperature": 0.2,
                "top_p": 0.9,
                "frequency_penalty": 1.0,
                "web_search_options": {
                    "search_context_size": "high"
                }
            }
            
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            
            print(f"Sending search request to Perplexity API for '{search_query}'")
            response = requests.post(url, json=payload, headers=headers)
            
            # Check for successful response
            if response.status_code == 200:
                response_data = response.json()
                
                # Extract the relevant information from the response
                search_content = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                # Extract YouTube video URLs and information from the response
                videos = self._extract_video_info(search_content)
                
                return {
                    "success": True,
                    "query": query,
                    "raw_response": search_content,
                    "videos": videos
                }
            else:
                error_msg = f"Perplexity API request failed with status code {response.status_code}"
                print(error_msg)
                try:
                    error_data = response.json()
                    error_detail = error_data.get("error", {}).get("message", "No error message provided")
                    error_msg += f": {error_detail}"
                except:
                    pass
                
                return {
                    "success": False,
                    "error": error_msg,
                    "query": query
                }
                
        except Exception as e:
            print(f"Error in _find_videos: {str(e)}")
            return {
                "success": False,
                "error": f"An error occurred while searching for videos: {str(e)}"
            }
    
    def _extract_video_info(self, text: str) -> List[Dict[str, str]]:
        """Extract YouTube video URLs and information from the search response"""
        videos = []
        
        # Look for YouTube URLs in the text
        url_pattern = r'https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)'
        url_matches = re.finditer(url_pattern, text)
        
        for match in url_matches:
            url = match.group(0)
            video_id = match.group(1)
            
            # Find the surrounding context for this URL to extract title and description
            # This is a simple approach - can be improved with better text parsing
            line_with_url = next((line for line in text.split('\n') if url in line), '')
            
            # Look for title above the URL
            title_candidates = []
            for line in text.split('\n'):
                if url in line:
                    break
                if line.strip() and not line.startswith('http'):
                    title_candidates.append(line.strip())
            
            title = title_candidates[-1] if title_candidates else "Unknown Title"
            
            # Clean up the title - attempt to remove list markers, etc.
            title = re.sub(r'^\d+[\.\)]\s*', '', title)
            title = re.sub(r'^-\s*', '', title)
            
            # Extract channel if possible
            channel = "Unknown Channel"
            channel_match = re.search(r'by ([^"(\[]+)', line_with_url)
            if channel_match:
                channel = channel_match.group(1).strip()
            
            videos.append({
                "title": title,
                "channel": channel,
                "url": url,
                "video_id": video_id
            })
        
        return videos
    
    def _analyze_transcript(self, video_id: str, topics: List[str]) -> Dict[str, Any]:
        """Use the YouTubeTranscriptTool to analyze the video transcript for the given topics"""
        try:
            # Create a fresh instance of YouTubeTranscriptTool and call its _run method
            transcript_tool = YouTubeTranscriptTool()
            return transcript_tool._run(video_id, topics)
        except Exception as e:
            print(f"Error analyzing transcript for video {video_id}: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to analyze transcript: {str(e)}",
                "video_id": video_id
            }