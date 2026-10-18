import type { BriefField, BriefSnapshot } from '@present/contracts/interviews';
import { evidenceItems, questionStatus } from './evidence';

export const interviewGuide = [
  { field: 'story', label: 'Career story', prompt: 'What connects the work you have done, and what would you like to do next?', answer: 'The thread through your experience, your recent role, and what comes next…', followUps: ['What changed in your most recent role?', 'What should the hiring manager understand about your path?'] },
  { field: 'work', label: 'A piece of real work', prompt: 'Walk me through something you owned end to end.', answer: 'Your contribution, scale, and what changed…', followUps: ['What part did you personally own?', 'How did you know it worked?'], question: 'scale' },
  { field: 'aiWork', label: 'AI workflow', prompt: 'Could you show me how your agents work?', answer: 'The workflow, tools or agents, what you tried, and what actually worked…', followUps: ['Could you walk through a real example?', 'Where do you review or correct the output?'], question: 'agentWorkflow' },
  { field: 'motivation', label: 'What comes next', prompt: 'What would make this the right next role for you?', answer: 'The work you want to own, what attracts you, and what we should clarify…', followUps: ['What would you like to keep doing hands-on?', 'What would you want to ask the hiring manager?'], question: 'ownership' },
  { field: 'compensation', label: 'Practical alignment', prompt: 'What should we align on before the next conversation?', answer: 'The range or target actually discussed, with any open details…', followUps: ['What working arrangement would work for you?', 'When could you realistically start?'], question: 'compensation' },
  { field: 'questions', label: 'Their questions', prompt: 'What questions do you have for us?', answer: 'Questions to bring to the hiring manager, and what remains unanswered…', followUps: ['What would you need to know to decide?', 'Would a conversation with the team help?'] },
] as const;
export function guideFor(field: BriefField) {
  return interviewGuide.find((item) => item.field === field) || interviewGuide[0];
}
export function guideState(snapshot: BriefSnapshot, field: BriefField) {
  const item = interviewGuide.find((entry) => entry.field === field);
  const state = item && 'question' in item ? questionStatus(evidenceItems(snapshot), item.question) : 'open';
  if (state !== 'open') return state;
  return snapshot.fields[field].trim() ? 'drafted' : 'open';
}
export function nextInterviewPrompt(snapshot: BriefSnapshot) {
  const current = guideFor(snapshot.studio.focus);
  const state = guideState(snapshot, current.field);
  const question = state === 'partial' || state === 'drafted' ? current.followUps[0] : current.prompt;
  const followUps = current.followUps.filter((item) => item !== question) as string[];
  if (followUps.length < 2) followUps.push('What should we make sure the hiring manager sees?');
  return { ...current, followUps, state, question };
}
