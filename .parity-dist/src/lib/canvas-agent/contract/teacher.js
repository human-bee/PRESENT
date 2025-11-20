import teacherContract from '../../../../generated/agent-contract.json';
export const TEACHER_ACTIONS = teacherContract.actions.map((action) => action.name);
export function getTeacherActionSchema(name) {
    const entry = teacherContract.actions.find((action) => action.name === name);
    if (!entry) {
        throw new Error(`Teacher action schema missing for ${name}`);
    }
    return entry.schema;
}
export function getTeacherContractMetadata() {
    return { generatedAt: teacherContract.generatedAt, source: teacherContract.source };
}
//# sourceMappingURL=teacher.js.map