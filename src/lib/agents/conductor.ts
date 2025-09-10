import { Agent,  run, tool } from '@openai/agents';
import z from 'zod';


const instructions = `
You are a conductor agent in our system. You're going to get natural language requests from the primary agent, and your job is to determine what needs doing and use the correct tool to accomplish the job. And then once you've accomplished the job from the request, return a single simple sentence on what got done and any high-level things that are needed to understand the job you did. 



<current_components_on_canvas>
${''}
</current_components_on_canvas>

Here's the last 500 characters of the transcript of the conversation so far:
<transcript_snippet>
${''}
</transcript_snippet>

If you need to know the full transcript, you can use the getFullTranscript tool.
`


const getComponentsOnCanvas = () => {
    return "This is a list of components on the canvas"
}

// TODO: update this to get the latest transcript snippet
const getLatestTranscriptSnippet = () => {
    return "This is a transcript of the conversation so far"
}

// TODO: update this to get the full transcript
const getFullTranscript = () => {
    return "This is a full transcript of the conversation so far"
}

const constant_tools: any[] = [
    getFullTranscript,
]
// follow this: https://openai.github.io/openai-agents-js/guides/mcp/
const constant_MCPs: any[] = [
    // Linear
    // Youtube api
    // weather
    // exa
    // other mcps
]

// User generated MCP tools from mcp config
const dynamic_MCPs: any[] = []


const all_tools_for_conductor: any[] = [...constant_tools, ...constant_MCPs, ...dynamic_MCPs]

export const conductor = new Agent({
  name: 'Conductor',
  model: 'gpt-5-mini',
  instructions: instructions,
  tools: all_tools_for_conductor,
});



export const callConductor = async (natural_language_request: string) => {
    const response = await run(conductor, natural_language_request)
    return response.finalOutput
}

// This is a tool for the livekit agent to use to ask the conductor to do something
export const callConductorAgent = tool({
    name: 'ask_conductor',
    description: 'Ask the conductor to do something',
    parameters: z.object({ 
      request: z.string().describe('What you want the conductor to do, in natural language. Be sure to add enough context to do the thing you want to do'),
    //   necessary_context: z.string().describe('Any necessary context to do the thing you want to do. This is for the conductor to use to understand the request.').optional()
    }),
    async execute({ request }) {
      console.log("askConductor", request);
      const oneLinerResponse = await callConductor(request)
      console.log(oneLinerResponse)
      return `Conductor says: ${oneLinerResponse}`;
    },
  });