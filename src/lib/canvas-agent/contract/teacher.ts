import templateContract from '../../../../generated/agent-contract.json';
import fairyContract from '../../../../generated/fairy-agent-contract.json';

export const TEACHER_CONTRACT_PROFILES = ['template24', 'fairy48'] as const;
export type TeacherContractProfile = (typeof TEACHER_CONTRACT_PROFILES)[number];

const TEACHER_CONTRACTS = {
  template24: templateContract,
  fairy48: fairyContract,
} as const;

type TemplateTeacherActionName = (typeof templateContract)['actions'][number]['name'];
type FairyTeacherActionName = (typeof fairyContract)['actions'][number]['name'];

export type TeacherActionName = TemplateTeacherActionName | FairyTeacherActionName;
export type TeacherActionContract = (typeof TEACHER_CONTRACTS)[TeacherContractProfile];

const normalizeTeacherProfile = (value: string | undefined): TeacherContractProfile => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'fairy' || normalized === 'fairy48') return 'fairy48';
  if (normalized === 'template' || normalized === 'template24') return 'template24';
  return 'fairy48';
};

export const ACTIVE_TEACHER_PROFILE = normalizeTeacherProfile(process.env.CANVAS_AGENT_CONTRACT_PROFILE);
export const ACTIVE_TEACHER_CONTRACT = TEACHER_CONTRACTS[ACTIVE_TEACHER_PROFILE];

export const TEACHER_ACTIONS_BY_PROFILE = {
  template24: templateContract.actions.map((action) => action.name) as TemplateTeacherActionName[],
  fairy48: fairyContract.actions.map((action) => action.name) as FairyTeacherActionName[],
} satisfies Record<TeacherContractProfile, TeacherActionName[]>;

const allActionNames = Array.from(
  new Set<TeacherActionName>([
    ...TEACHER_ACTIONS_BY_PROFILE.template24,
    ...TEACHER_ACTIONS_BY_PROFILE.fairy48,
  ]),
);

// TEACHER_ACTIONS is intentionally the merged union so compatibility actions
// remain parseable while fairy48 is the default profile.
export const TEACHER_ACTIONS = allActionNames as TeacherActionName[];
export const ACTIVE_TEACHER_ACTIONS = TEACHER_ACTIONS_BY_PROFILE[ACTIVE_TEACHER_PROFILE];

export function getTeacherContract(profile: TeacherContractProfile = ACTIVE_TEACHER_PROFILE) {
  return TEACHER_CONTRACTS[profile];
}

export function getTeacherActionSchema(
  name: TeacherActionName,
  profile: TeacherContractProfile = ACTIVE_TEACHER_PROFILE,
) {
  const preferred = getTeacherContract(profile).actions.find((action) => action.name === name);
  if (preferred) return preferred.schema;
  for (const candidate of TEACHER_CONTRACT_PROFILES) {
    const fallback = TEACHER_CONTRACTS[candidate].actions.find((action) => action.name === name);
    if (fallback) return fallback.schema;
  }
  throw new Error(`Teacher action schema missing for ${name}`);
}

export function getTeacherContractMetadata(profile: TeacherContractProfile = ACTIVE_TEACHER_PROFILE) {
  const contract = getTeacherContract(profile);
  return {
    profile,
    generatedAt: contract.generatedAt,
    source: contract.source,
    actionCount: contract.actions.length,
  };
}
