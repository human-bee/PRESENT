import type { BriefField, BriefSnapshot, BriefSource } from '@present/contracts/interviews';
import type { InterviewAsset } from '@present/contracts/interview-studio';

export const evidenceQuestions = [
  { id: 'scale', label: 'Infrastructure scale', question: 'What infrastructure has the candidate personally built and operated?' },
  { id: 'agentWorkflow', label: 'Agent workflow', question: 'What has been tried, what worked, and what still needs a demonstration?' },
  { id: 'ownership', label: 'Ownership', question: 'What does the candidate want to own next?' },
  { id: 'compensation', label: 'Compensation', question: 'What salary range or target has actually been discussed?' },
  { id: 'start', label: 'Start timing', question: 'When could the candidate start?' },
  { id: 'team', label: 'Team & challenges', question: 'How large is the team and what challenges is it tackling?' },
  { id: 'location', label: 'Working arrangements', question: 'Where is the candidate based and what working arrangement is agreed?' },
] as const;

export const evidenceFieldNames: Partial<Record<BriefField, string>> = {
  name: 'Candidate name', title: 'Role title', company: 'Company', workTitle: 'Work headline', roleContext: 'Role context',
  story: 'Interview summary', work: 'Engineering', aiWork: 'AI-assisted delivery', research: 'Profile research',
  motivation: 'Interest & ownership', compensation: 'Compensation', workplace: 'Working arrangements',
  timing: 'Timing', questions: 'Open questions', location: 'Location', experience: 'Experience', availability: 'Availability',
};
export type EvidenceSelection = { field: BriefField; text: string };
export type EvidenceItem = { id: string; field: BriefField; source: BriefSource; speaker: string; timestamp: number; transcriptText?: string };
export type EvidenceNode = { id: string; label: string; kind: 'claim' | 'section' | 'question' | 'material'; status?: string; evidenceId?: string; materialId?: string; field?: BriefField };
export type EvidenceGraph = { nodes: EvidenceNode[]; edges: Array<{ from: string; to: string }>; items: EvidenceItem[]; materials: InterviewAsset[] };

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(36);
}
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function evidenceItems(snapshot: BriefSnapshot): EvidenceItem[] {
  return Object.entries(snapshot.sources).flatMap(([field, sources]) => (sources ?? []).map((source) => {
    const transcript = snapshot.transcripts.find((item) => item.id === source.transcriptId);
    return {
      id: `evidence-${hash(`${field}:${source.transcriptId || ''}:${source.quote || ''}:${source.statement || source.label}`)}`,
      field: field as BriefField, source, speaker: transcript?.speaker || source.label, timestamp: transcript?.timestamp || 0, transcriptText: transcript?.text,
    };
  })).sort((a, b) => a.timestamp - b.timestamp);
}

export function selectEvidence(items: EvidenceItem[], selection?: EvidenceSelection) {
  if (!selection) return { items, match: 'all' as const };
  const section = items.filter((item) => item.field === selection.field);
  const text = normalize(selection.text);
  const exact = text ? section.filter((item) => normalize(item.source.statement || '').includes(text)
    || normalize(item.source.quote || '').includes(text)) : [];
  return exact.length ? { items: exact, match: 'exact' as const } : { items: section, match: 'section' as const };
}

export function questionStatus(items: EvidenceItem[], id: string) {
  const claims = items.filter((item) => item.source.questionId === id);
  if (claims.some((item) => item.source.answerStatus === 'answered')) return 'answered';
  if (claims.some((item) => item.source.answerStatus === 'partial')) return 'partial';
  return 'open';
}

export function buildEvidenceGraph(snapshot: BriefSnapshot): EvidenceGraph {
  const items = evidenceItems(snapshot);
  const nodes: EvidenceNode[] = evidenceQuestions.map((question) => ({
    id: `question-${question.id}`, label: question.label, kind: 'question', status: questionStatus(items, question.id),
  }));
  const edges: EvidenceGraph['edges'] = [];
  const sections = new Set<BriefField>();
  for (const item of items.slice(-60)) {
    const sectionId = `section-${item.field}`;
    if (!sections.has(item.field)) {
      sections.add(item.field);
      nodes.push({ id: sectionId, label: evidenceFieldNames[item.field] || item.field, kind: 'section', field: item.field });
    }
    const quote = item.source.statement || item.source.quote || item.source.label;
    const scale = quote.match(/(?:about\s+)?[\d,+]+\s+(?:(?:different\s+)?Kubernetes\s+)?clusters/i)?.[0];
    nodes.push({ id: item.id, label: scale || quote.split(/\s+/).slice(0, 5).join(' '), kind: 'claim', evidenceId: item.id, field: item.field });
    edges.push({ from: sectionId, to: item.id });
    if (item.source.questionId) edges.push({ from: item.id, to: `question-${item.source.questionId}` });
  }
  for (const asset of snapshot.studio.assets) {
    const sectionId = `section-${asset.field}`;
    if (!sections.has(asset.field)) { sections.add(asset.field); nodes.push({ id: sectionId,label: evidenceFieldNames[asset.field] || asset.field,kind: 'section',field: asset.field }); }
    nodes.push({ id: `material-${asset.id}`,label: asset.title,kind: 'material',materialId: asset.id,field: asset.field });
    edges.push({ from: `material-${asset.id}`,to: sectionId });
  }
  return { nodes, edges, items,materials: snapshot.studio.assets };
}
