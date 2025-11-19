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

export const createHttpTeacherService = (_endpoint: string): TeacherService => {
  return {
    stream: async function* httpStream() {
      throw new Error('HTTP teacher service not implemented yet');
    },
  };
};
