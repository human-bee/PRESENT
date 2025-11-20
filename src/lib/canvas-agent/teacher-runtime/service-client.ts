import type { TeacherPromptContext } from './prompt';
import type { Streaming } from '../../../../vendor/tldraw-agent-template/shared/types/Streaming';
import type { AgentAction } from '../../../../vendor/tldraw-agent-template/shared/types/AgentAction';

type TeacherRuntimeModule = typeof import('./service');

export type TeacherStreamEvent = Streaming<AgentAction>;

export interface TeacherService {
  stream: (context: TeacherPromptContext, options: { dispatchActions: boolean }) => AsyncIterable<TeacherStreamEvent>;
}

let teacherRuntimeModulePromise: Promise<TeacherRuntimeModule | null> | null = null;
let teacherRuntimeLastError: string | null = null;

const loadTeacherRuntimeModule = async (): Promise<TeacherRuntimeModule | null> => {
  if (!teacherRuntimeModulePromise) {
    teacherRuntimeModulePromise = import('./service')
      .then((mod) => {
        teacherRuntimeLastError = null;
        return mod;
      })
      .catch((error) => {
        teacherRuntimeLastError =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown teacher runtime error';
        return null;
      });
  }
  return teacherRuntimeModulePromise;
};

export const getTeacherRuntimeLastError = () => teacherRuntimeLastError;

export const getInProcessTeacherService = async (): Promise<TeacherService | null> => {
  const module = await loadTeacherRuntimeModule();
  if (!module) return null;
  return {
    stream: async function* stream(context, options) {
      void options;
      for await (const event of module.streamTeacherAgent(context)) {
        yield event;
      }
    },
  } satisfies TeacherService;
};

const parseLine = (line: string): TeacherStreamEvent | null => {
  try {
    const parsed = JSON.parse(line) as TeacherStreamEvent;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (error) {
    console.warn('[CanvasAgent:TeacherHttpParseError]', {
      error: error instanceof Error ? error.message : error,
      line,
    });
  }
  return null;
};

export const createHttpTeacherService = (endpoint: string): TeacherService => {
  const baseUrl = endpoint.replace(/\/+$/, '');
  return {
    stream: async function* stream(context) {
      const response = await fetch(`${baseUrl}/teacher/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(context),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Teacher HTTP error: ${response.status} ${response.statusText}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length) {
            const parsed = parseLine(line);
            if (parsed) {
              yield parsed;
            }
          }
          newlineIndex = buffer.indexOf('\n');
        }
      }
      if (buffer.trim().length) {
        const parsed = parseLine(buffer.trim());
        if (parsed) {
          yield parsed;
        }
      }
    },
  } satisfies TeacherService;
};

export const getTeacherServiceForEndpoint = async (
  endpoint?: string | null,
): Promise<TeacherService | null> => {
  if (endpoint && endpoint.trim().length) {
    return createHttpTeacherService(endpoint);
  }
  return getInProcessTeacherService();
};
