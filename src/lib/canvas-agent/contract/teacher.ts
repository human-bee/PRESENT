import teacherContract from '../../../../generated/agent-contract.json';

export type TeacherActionContract = typeof teacherContract;

export type TeacherActionName = TeacherActionContract['actions'][number]['name'];

export const TEACHER_ACTIONS = teacherContract.actions.map((action) => action.name) as TeacherActionName[];

export function getTeacherActionSchema(name: TeacherActionName) {
  const entry = teacherContract.actions.find((action) => action.name === name);
  if (!entry) {
    throw new Error(`Teacher action schema missing for ${name}`);
  }
  return entry.schema;
}

export function getTeacherContractMetadata() {
  return { generatedAt: teacherContract.generatedAt, source: teacherContract.source };
}
