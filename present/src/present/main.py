#!/usr/bin/env python
from present.crew import Present

def run():
    """
    Run the fact checker crew.
    """
    inputs = {
        'statement': "The CrewAI framework was released in 2023.",
        'topic': "CrewAI release date"
    }
    Present().crew().kickoff(inputs=inputs)

if __name__ == "__main__":
    run()