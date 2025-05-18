from crewai.tools import BaseTool
from typing import Dict, List, Optional, Any
import os
import logging
import sys
import traceback
import json
import requests

class PerplexityResearchTool(BaseTool):
    """Tool for performing deep research using the Perplexity API."""
    
    name: str = "Perplexity Deep Research"
    description: str = "Performs in-depth research on people, organizations, or topics using the Perplexity API."
    
    def __init__(self):
        # Call the parent constructor with no args
        BaseTool.__init__(self)
        print("PerplexityResearchTool initialized")
    
    def _run(self, query: str, mode: str = "concise") -> Dict[str, Any]:
        """
        Run the tool to perform research using Perplexity API.
        
        Args:
            query: The research question or topic to investigate
            mode: Research mode - 'concise' for short summaries or 'detailed' for in-depth research
            
        Returns:
            Dictionary with research results
        """
        print(f"_run method called with: query={query}, mode={mode}")
        
        try:
            # Get API key from environment variable
            api_key = os.getenv("PERPLEXITY_API_KEY")
            print(f"API key found: {'Yes' if api_key else 'No'}")
            
            if not api_key:
                return {
                    "success": False,
                    "error": "No Perplexity API key found. Please set the PERPLEXITY_API_KEY environment variable."
                }
            
            # Prepare the API request
            url = "https://api.perplexity.ai/chat/completions"
            
            # Configure model and settings based on mode
            if mode == "concise":
                model = "sonar-medium-online"
                max_tokens = 2048
                system_prompt = "You are a research assistant that provides accurate, factual information about people, organizations, and topics. Be concise and direct in your responses. Cite your sources clearly."
            else:  # detailed mode
                model = "sonar-large-online"
                max_tokens = 4000
                system_prompt = "You are a thorough research assistant that provides comprehensive, in-depth information about people, organizations, and topics. Include detailed background, context, and analysis. Examine multiple perspectives and cite your sources clearly."
            
            # Prepare the request payload according to Perplexity API specs
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": query
                    }
                ],
                "max_tokens": max_tokens,
                "temperature": 0.2,  # Lower temperature for more factual responses
                "top_p": 0.9,        # Default from Perplexity docs
                "frequency_penalty": 1.0,  # Helps reduce repetition
                "web_search_options": {
                    "search_context_size": "high"  # Enable comprehensive web search
                }
            }
            
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            
            print(f"Sending research request to Perplexity API for '{query}'")
            response = requests.post(url, json=payload, headers=headers)
            
            # Check for successful response
            if response.status_code == 200:
                response_data = response.json()
                
                # Extract the relevant information from the response
                research_content = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                # Extract sources (if included in the response)
                sources = []
                try:
                    # This is a simplified approach - actual source extraction may depend on Perplexity's response format
                    if "sources:" in research_content.lower():
                        sources_section = research_content.lower().split("sources:")[1].strip()
                        sources = [s.strip() for s in sources_section.split("\n") if s.strip()]
                    elif "references:" in research_content.lower():
                        sources_section = research_content.lower().split("references:")[1].strip()
                        sources = [s.strip() for s in sources_section.split("\n") if s.strip()]
                except:
                    # If source extraction fails, continue without sources
                    pass
                
                return {
                    "success": True,
                    "research_content": research_content,
                    "sources": sources,
                    "query": query,
                    "mode": mode,
                    "model_used": model
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
            print(f"Error in PerplexityResearchTool._run: {str(e)}")
            traceback.print_exc(file=sys.stdout)
            return {
                "success": False,
                "error": f"An error occurred: {str(e)}",
                "traceback": traceback.format_exc()
            }