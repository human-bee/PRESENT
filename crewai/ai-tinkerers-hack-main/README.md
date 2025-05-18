# Present Crew

Welcome to the Present Crew project, powered by [crewAI](https://crewai.com). This template is designed to help you set up a multi-agent AI system with ease, leveraging the powerful and flexible framework provided by crewAI. Our goal is to enable your agents to collaborate effectively on complex tasks, maximizing their collective intelligence and capabilities.

## Installation

Ensure you have Python >=3.10 <3.13 installed on your system. This project uses [UV](https://docs.astral.sh/uv/) for dependency management and package handling, offering a seamless setup and execution experience.

First, if you haven't already, install uv:

```bash
pip install uv
```

Next, navigate to your project directory and create a virtual environment:

```bash
uv venv
```

Activate the virtual environment:

```bash
source .venv/bin/activate
```

Install the dependencies (be sure to quote the package name to avoid shell issues):

```bash
uv pip install 'crewai[tools]'
```

If you encounter `zsh: no matches found: crewai[tools]`, make sure to use single quotes as shown above.

If you see an error about no Python interpreters found in virtual environments, run `uv venv` first to create the virtual environment.

### Customizing

**Add your `OPENAI_API_KEY` into the `.env` file**

- Modify `src/present/config/agents.yaml` to define your agents
- Modify `src/present/config/tasks.yaml` to define your tasks
- Modify `src/present/crew.py` to add your own logic, tools and specific args
- Modify `src/present/main.py` to add custom inputs for your agents and tasks

## Running the Project
In the root of this folder, add a .env file and add the API keys for the following:

MODEL=
OPENAI_API_KEY=
SERPER_API_KEY=
YOUTUBE_API_KEY=

To kickstart your crew of AI agents and begin task execution, **always run commands from inside the `crewai/ai-tinkerers-hack-main` directory** (where the `.venv` folder is located):

```bash
cd crewai/ai-tinkerers-hack-main
source .venv/bin/activate
crewai run
```

This command initializes the present Crew, assembling the agents and assigning them tasks as defined in your configuration.

If you see `zsh: command not found: crewai`, make sure your virtual environment is activated (`source .venv/bin/activate`).

This example, unmodified, will run and create a `report.md` file with the output of a research on LLMs in the root folder.

### Running the API Server

To run the API server (for programmatic access or integration), **make sure you are in the `crewai/ai-tinkerers-hack-main` directory** and run:

```bash
source .venv/bin/activate
python run_api.py
```

Or, equivalently:

```bash
.venv/bin/python run_api.py
```

### Installing Additional Python Packages

To install additional Python packages (such as `google-api-python-client` or `youtube-transcript-api`), always activate your virtual environment first:

```bash
cd crewai/ai-tinkerers-hack-main
source .venv/bin/activate
pip install <package-name>
```

Or, to be explicit:

```bash
.venv/bin/python -m pip install <package-name>
```

## Troubleshooting

- **Error:** `zsh: no such file or directory: .venv/bin/python`
  - **Solution:** Make sure you are in the `crewai/ai-tinkerers-hack-main` directory before running `.venv/bin/python ...` or activating the venv.

- **Error:** `ModuleNotFoundError` for a package you installed
  - **Solution:** Make sure you installed the package while the virtual environment was activated. If not, activate the venv and reinstall the package.

- **Error:** `zsh: command not found: crewai`
  - **Solution:** Activate the virtual environment with `source .venv/bin/activate`.

- **General tip:** If you ever close your terminal, always `cd` back into `crewai/ai-tinkerers-hack-main` and `source .venv/bin/activate` before running any commands.

## Understanding Your Crew

The present Crew is composed of multiple AI agents, each with unique roles, goals, and tools. These agents collaborate on a series of tasks, defined in `config/tasks.yaml`, leveraging their collective skills to achieve complex objectives. The `config/agents.yaml` file outlines the capabilities and configurations of each agent in your crew.

## Support

For support, questions, or feedback regarding the Present Crew or crewAI.
- Visit our [documentation](https://docs.crewai.com)
- Reach out to us through our [GitHub repository](https://github.com/joaomdmoura/crewai)
- [Join our Discord](https://discord.com/invite/X4JWnZnxPb)
- [Chat with our docs](https://chatg.pt/DWjSBZn)

Let's create wonders together with the power and simplicity of crewAI.
