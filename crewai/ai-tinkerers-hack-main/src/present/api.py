from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
import uvicorn
import os
import json
from dotenv import load_dotenv
from present.crew import Present

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Content Analysis API")

# Define request and response models
class FactCheckRequest(BaseModel):
    content: str
    additional_info: Optional[Dict[str, Any]] = None

class YouTubeAnalysisRequest(BaseModel):
    video_url: str
    topics: List[str]
    additional_info: Optional[Dict[str, Any]] = None

class ProfileResearchRequest(BaseModel):
    query: str
    mode: Optional[str] = "concise"  # Default to concise mode
    additional_info: Optional[Dict[str, Any]] = None

class EnhancedYouTubeRequest(BaseModel):
    query: str
    topics: Optional[List[str]] = None
    limit: Optional[int] = 3
    mode: Optional[str] = "concise"  # Default to concise mode
    additional_info: Optional[Dict[str, Any]] = None

class ApiResponse(BaseModel):
    results: Any
    status: str

# Define API endpoints
@app.post("/fact-check", response_model=ApiResponse)
async def fact_check(request: FactCheckRequest):
    """
    Endpoint to fact check content using CrewAI
    """
    try:
        # Initialize your crew
        crew = Present().crew()
        
        # Prepare inputs for the crew
        inputs = {
            "statement": request.content
        }
        
        # Add any additional info if provided
        if request.additional_info:
            inputs.update(request.additional_info)
        
        # Run the crew
        results = crew.kickoff(inputs=inputs)
        
        # Return the results
        return ApiResponse(
            results=results,
            status="success"
        )
    except Exception as e:
        import traceback
        print(f"Error in fact_check: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@app.post("/analyze-youtube", response_model=ApiResponse)
async def analyze_youtube(request: YouTubeAnalysisRequest):
    """
    Endpoint to analyze YouTube video transcripts
    """
    try:
        print(f"Received request to analyze YouTube video: {request.video_url}")
        print(f"Topics to analyze: {request.topics}")
        
        # Create a dedicated crew for YouTube analysis
        present = Present()
        youtube_crew = present.youtube_analysis_crew()
        
        # Format the topics list as a JSON string for proper template interpolation
        formatted_topics = json.dumps(request.topics)
        
        # Prepare inputs for the crew
        inputs = {
            "video_url": request.video_url,
            "topics": formatted_topics
        }
        
        print(f"Passing inputs to crew: {inputs}")
        
        # Add any additional info if provided
        if request.additional_info:
            inputs.update(request.additional_info)
        
        # Run the crew
        results = youtube_crew.kickoff(inputs=inputs)
        
        # Return the results
        return ApiResponse(
            results=results,
            status="success"
        )
    except Exception as e:
        import traceback
        print(f"Error in analyze_youtube: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@app.post("/profile-research", response_model=ApiResponse)
async def profile_research(request: ProfileResearchRequest):
    """
    Endpoint to perform deep research on a person or organization using Perplexity API
    """
    try:
        print(f"Received request to research profile: {request.query}")
        print(f"Research mode: {request.mode}")
        
        # Create a dedicated crew for profile research
        present = Present()
        research_crew = present.profile_research_crew()
        
        # Prepare inputs for the crew
        inputs = {
            "query": request.query,
            "mode": request.mode
        }
        
        print(f"Passing inputs to crew: {inputs}")
        
        # Add any additional info if provided
        if request.additional_info:
            inputs.update(request.additional_info)
        
        # Run the crew
        results = research_crew.kickoff(inputs=inputs)
        
        # Return the results
        return ApiResponse(
            results=results,
            status="success"
        )
    except Exception as e:
        import traceback
        print(f"Error in profile_research: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@app.post("/enhanced-youtube-search", response_model=ApiResponse)
async def enhanced_youtube_search(request: EnhancedYouTubeRequest):
    """
    Endpoint to find and analyze YouTube videos related to a specific topic using Perplexity for search
    and transcript analysis for content
    """
    try:
        print(f"Received request to find and analyze YouTube videos about: {request.query}")
        print(f"Topics to analyze: {request.topics}")
        print(f"Video limit: {request.limit}")
        print(f"Research mode: {request.mode}")
        
        # Create a dedicated crew for enhanced YouTube search and analysis
        present = Present()
        enhanced_youtube_crew = present.enhanced_youtube_crew()
        
        # Format the topics list as a JSON string for proper template interpolation
        formatted_topics = "null"
        if request.topics:
            formatted_topics = json.dumps(request.topics)
        
        # Prepare inputs for the crew
        inputs = {
            "query": request.query,
            "topics": formatted_topics,
            "limit": request.limit,
            "mode": request.mode
        }
        
        print(f"Passing inputs to crew: {inputs}")
        
        # Add any additional info if provided
        if request.additional_info:
            inputs.update(request.additional_info)
        
        # Run the crew
        results = enhanced_youtube_crew.kickoff(inputs=inputs)
        
        # Return the results
        return ApiResponse(
            results=results,
            status="success"
        )
    except Exception as e:
        import traceback
        print(f"Error in enhanced_youtube_search: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")

@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    return {"status": "healthy"}

# For direct execution of this file
if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)