export const CAPABILITIES = [
  { kind: 'document', title: 'Shared document', description: 'Write Markdown, preview it and save versions.' },
  { kind: 'kanban', title: 'Task board', description: 'Track tasks, owners and progress together.' },
  { kind: 'brief', title: 'Meeting brief', description: 'Keep the summary, decisions and next actions together.' },
  { kind: 'audience', title: 'Audience Q&A', description: 'Collect questions, vote and choose what to discuss.' },
  { kind: 'captions', title: 'Live captions', description: 'Read final captions shared by the room.' },
  { kind: 'debate', title: 'Debate desk', description: 'Collect claims, inspect evidence and score each side.' },
  { kind: 'cards', title: 'Shared deck', description: 'Draw, reveal and return cards around a shared table.' },
  { kind: 'dice', title: 'Dice table', description: 'Roll common dice with a shared, attributed history.' },
] as const;

export type CapabilityKind = typeof CAPABILITIES[number]['kind'];

/** Each record lives at its own state key; never replace the full state map. */
export type CapabilityTask = {
  id: string;
  title: string;
  owner: string;
  status: 'To do' | 'Doing' | 'Done';
  at: number;
  createdBy: string;
};

export type CapabilityClaim = {
  id: string;
  text: string;
  side: 'Affirmative' | 'Negative';
  quotedEvidence: string;
  sourceURLs: string[];
  status: 'pending' | 'verified' | 'disputed';
  at: number;
  createdBy: string;
  verifiedBy?: string | null;
  verifiedAt?: number | null;
};

export type CapabilityVersion = { id: string; text: string; at: number; actor: string };
export type CapabilityBriefEntry = { id: string; text: string; at: number; createdBy: string };
export type CapabilityQuestion = CapabilityBriefEntry;

/** `question:<id>` stores text; status and votes are independent shared keys. */
export type CapabilityAudienceState = { activeQuestionId: string | null } & Record<string, unknown>;
/** `decision:<id>` / `action:<id>` store entries; `owner:<id>` and `status:<id>` belong to actions. */
export type CapabilityBriefState = { summary: string } & Record<string, unknown>;

/** Text is shared at `markdown`; saved versions use `version:<id>` keys. */
export type CapabilityDocumentState = { markdown: string } & Record<string, unknown>;

/** Task entries use `task:<id>`. Claim entries use `claim:<id>`. */
export type CapabilityRecordState = Record<string, CapabilityTask | CapabilityClaim | CapabilityVersion | CapabilityBriefEntry | string | number | boolean | null>;

export function isCapabilityKind(value: unknown): value is CapabilityKind {
  return CAPABILITIES.some((capability) => capability.kind === value);
}
