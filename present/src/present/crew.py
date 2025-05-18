from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai_tools import SerperDevTool, FileReadTool
from crewai.agents.agent_builder.base_agent import BaseAgent
from typing import List
# Import the YouTubeTranscriptTool
from present.tools.youtube_tool import YouTubeTranscriptTool

@CrewBase
class Present():
    """Fact checker crew for verifying claims"""

    agents: List[BaseAgent]
    tasks: List[Task]

    @agent
    def fact_checker(self) -> Agent:
        return Agent(
            config=self.agents_config['fact_checker'],  # type: ignore[index]
            verbose=True,
            tools=[SerperDevTool()]
        )

    @agent
    def context_provider(self) -> Agent:
        return Agent(
            config=self.agents_config['context_provider'],  # type: ignore[index]
            verbose=True,
            tools=[FileReadTool()]
        )
    
    @agent
    def youtube_analyzer(self) -> Agent:
        # Create an instance of the tool - THIS IS THE KEY CHANGE
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
            config=self.agents_config['youtube_analyzer'],  # type: ignore[index]
            verbose=True,
            tools=[youtube_tool],  # Pass the INSTANCE, not the class
            llm_config={"temperature": 0.2},  # Lower temperature for more predictable output
            execution_template=execution_template  # Custom template for more consistent execution
        )

    @task
    def context_task(self) -> Task:
        return Task(
            config=self.tasks_config['context_task'],  # type: ignore[index]
        )

    @task
    def fact_check_task(self) -> Task:
        return Task(
            config=self.tasks_config['fact_check_task'],  # type: ignore[index]
            context=[self.context_task()]
        )
    
    @task
    def youtube_analysis_task(self) -> Task:
        return Task(
            config=self.tasks_config['youtube_analysis_task'],  # type: ignore[index]
        )

    @crew
    def crew(self) -> Crew:
        """Creates the fact checker crew"""
        return Crew(
            agents=self.agents,  # Automatically created by the @agent decorator
            tasks=[self.fact_check_task()],  # Default crew only handles fact checking
            process=Process.sequential,
            verbose=True,
        )