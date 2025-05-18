from crewai import Agent, Crew, Process, Task
from crewai_tools import SerperDevTool, FileReadTool
from typing import List, Dict, Any
import os
import yaml
# Import the tools
from present.tools.youtube_tool import YouTubeTranscriptTool
from present.tools.perplexity_tool import PerplexityResearchTool
from present.tools.enhanced_youtube_tool import EnhancedYouTubeTool

# This function will help us load YAML files safely
def load_yaml(file_path: str) -> Dict[str, Any]:
    """Load YAML configuration file with better error handling and path resolution"""
    try:
        # Try the direct path first
        if os.path.exists(file_path):
            with open(file_path, 'r') as f:
                return yaml.safe_load(f)
                
        # Try adding src/present prefix if not found
        if not file_path.startswith('src/present/'):
            alt_path = f"src/present/{file_path}"
            if os.path.exists(alt_path):
                with open(alt_path, 'r') as f:
                    return yaml.safe_load(f)
                    
        # Try removing src/present prefix if not found
        if file_path.startswith('src/present/'):
            alt_path = file_path.replace('src/present/', '')
            if os.path.exists(alt_path):
                with open(alt_path, 'r') as f:
                    return yaml.safe_load(f)
        
        # Look for the file in various locations relative to the current directory
        for search_dir in ['.', 'src', 'src/present', 'config', 'src/present/config']:
            alt_path = os.path.join(search_dir, os.path.basename(file_path))
            if os.path.exists(alt_path):
                with open(alt_path, 'r') as f:
                    return yaml.safe_load(f)
                    
        # If we got here, we couldn't find the file
        print(f"Warning: Could not find YAML file {file_path}")
        return {}
    except Exception as e:
        print(f"Error loading YAML file {file_path}: {e}")
        return {}

# Create a Present class without using CrewBase or decorators
class Present:
    """Fact checker crew for verifying claims"""
    
    def __init__(self):
        """Initialize the present class, loading configurations directly"""
        # Load configurations from YAML files
        self.agents_config = load_yaml('config/agents.yaml')
        self.tasks_config = load_yaml('config/tasks.yaml')
        
        # Print loaded configs for debugging
        print(f"Loaded agents: {list(self.agents_config.keys())}")
        print(f"Loaded tasks: {list(self.tasks_config.keys())}")

    def fact_checker(self) -> Agent:
        """Create fact checker agent"""
        return Agent(
            role=self.agents_config['fact_checker']['role'],
            goal=self.agents_config['fact_checker']['goal'],
            backstory=self.agents_config['fact_checker']['backstory'],
            verbose=True,
            tools=[SerperDevTool()]
        )

    def context_provider(self) -> Agent:
        """Create context provider agent"""
        return Agent(
            role=self.agents_config['context_provider']['role'],
            goal=self.agents_config['context_provider']['goal'],
            backstory=self.agents_config['context_provider']['backstory'],
            verbose=True,
            tools=[FileReadTool()]
        )
    
    def youtube_analyzer(self) -> Agent:
        """Create YouTube analyzer agent"""
        # Create an instance of the tool
        youtube_tool = YouTubeTranscriptTool()
        
        # Define an execution template to guide the agent
        execution_template = """
I need to analyze a YouTube video transcript for specific topics.

Thought: {thinking}
Action: YouTube Transcript Analyzer
Action Input: {{"video_url": "{video_url}", "topics": {topics}}}
Observation: {observation}

Based on this analysis, I can now provide a comprehensive report.
"""
        
        return Agent(
            role=self.agents_config['youtube_analyzer']['role'],
            goal=self.agents_config['youtube_analyzer']['goal'],
            backstory=self.agents_config['youtube_analyzer']['backstory'],
            verbose=True,
            tools=[youtube_tool],
            llm_config={"temperature": 0.2},
            execution_template=execution_template
        )
    
    def enhanced_youtube_analyzer(self) -> Agent:
        """Create enhanced YouTube analyzer agent"""
        # Create an instance of the enhanced YouTube tool
        enhanced_youtube_tool = EnhancedYouTubeTool()
        
        # Define an execution template to guide the agent
        execution_template = """
I need to find and analyze YouTube videos about a specific topic.

Thought: {thinking}
Action: Enhanced YouTube Analyzer
Action Input: {{"query": "{query}", "topics": {topics}, "limit": {limit}, "mode": "{mode}"}}
Observation: {observation}

Based on this research and analysis, I can now provide a comprehensive report on the videos.
"""
        
        return Agent(
            role=self.agents_config['enhanced_youtube_analyzer']['role'],
            goal=self.agents_config['enhanced_youtube_analyzer']['goal'],
            backstory=self.agents_config['enhanced_youtube_analyzer']['backstory'],
            verbose=True,
            tools=[enhanced_youtube_tool, SerperDevTool()],
            llm_config={"temperature": 0.2},
            execution_template=execution_template
        )
    
    def profile_researcher(self) -> Agent:
        """Create profile researcher agent"""
        # Create an instance of the Perplexity Research tool
        perplexity_tool = PerplexityResearchTool()
        
        # Define an execution template to guide the agent
        execution_template = """
I need to research and create a comprehensive profile using the Perplexity API.

Thought: {thinking}
Action: Perplexity Deep Research
Action Input: {{"query": "{query}", "mode": "{mode}"}}
Observation: {observation}

Based on this research, I can now provide a well-sourced profile report.
"""
        
        return Agent(
            role=self.agents_config['profile_researcher']['role'],
            goal=self.agents_config['profile_researcher']['goal'],
            backstory=self.agents_config['profile_researcher']['backstory'],
            verbose=True,
            tools=[perplexity_tool, SerperDevTool()],
            llm_config={"temperature": 0.2},
            execution_template=execution_template
        )

    def context_task(self) -> Task:
        """Create context task"""
        return Task(
            description=self.tasks_config['context_task']['description'],
            expected_output=self.tasks_config['context_task']['expected_output'],
            agent=self.context_provider()
        )

    def fact_check_task(self) -> Task:
        """Create fact check task"""
        return Task(
            description=self.tasks_config['fact_check_task']['description'],
            expected_output=self.tasks_config['fact_check_task']['expected_output'],
            agent=self.fact_checker(),
            context=[self.context_task()]
        )
    
    def youtube_analysis_task(self) -> Task:
        """Create YouTube analysis task"""
        return Task(
            description=self.tasks_config['youtube_analysis_task']['description'],
            expected_output=self.tasks_config['youtube_analysis_task']['expected_output'],
            agent=self.youtube_analyzer()
        )
    
    def enhanced_youtube_search_task(self) -> Task:
        """Create enhanced YouTube search and analysis task"""
        return Task(
            description=self.tasks_config['enhanced_youtube_search_task']['description'],
            expected_output=self.tasks_config['enhanced_youtube_search_task']['expected_output'],
            agent=self.enhanced_youtube_analyzer()
        )
        
    def profile_research_task(self) -> Task:
        """Create profile research task"""
        return Task(
            description=self.tasks_config['profile_research_task']['description'],
            expected_output=self.tasks_config['profile_research_task']['expected_output'],
            agent=self.profile_researcher()
        )

    def crew(self) -> Crew:
        """Creates the fact checker crew"""
        return Crew(
            agents=[self.fact_checker(), self.context_provider()],
            tasks=[self.fact_check_task()],
            process=Process.sequential,
            verbose=True,
        )
    
    def profile_research_crew(self) -> Crew:
        """Creates a crew focused on profile research"""
        return Crew(
            agents=[self.profile_researcher()],
            tasks=[self.profile_research_task()],
            process=Process.sequential,
            verbose=True,
        )
        
    def youtube_analysis_crew(self) -> Crew:
        """Creates a crew focused on YouTube analysis"""
        return Crew(
            agents=[self.youtube_analyzer()],
            tasks=[self.youtube_analysis_task()],
            process=Process.sequential,
            verbose=True,
        )
        
    def enhanced_youtube_crew(self) -> Crew:
        """Creates a crew focused on enhanced YouTube search and analysis"""
        return Crew(
            agents=[self.enhanced_youtube_analyzer()],
            tasks=[self.enhanced_youtube_search_task()],
            process=Process.sequential,
            verbose=True,
        )