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
        
        # Import necessary components
        from crewai import Crew, Process
        from present.crew import Present
        
        # Create a dedicated crew for YouTube analysis
        present = Present()
        youtube_analyzer = present.youtube_analyzer()
        youtube_task = present.youtube_analysis_task()
        
        # Create a crew with just the YouTube analyzer and task
        youtube_crew = Crew(
            agents=[youtube_analyzer],
            tasks=[youtube_task],
            process=Process.sequential,
            verbose=True,
        )
        
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

@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    return {"status": "healthy"}

# For direct execution of this file
if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)