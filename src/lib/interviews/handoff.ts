import type { BriefSnapshot } from '@present/contracts/interviews';

export const handoffSections = [
  ['Interview summary', 'story'], ['Infrastructure and engineering approach', 'work'],
  ['AI-assisted delivery', 'aiWork'], ['Interest and practical alignment', 'motivation'],
  ['Compensation', 'compensation'], ['Working arrangements', 'workplace'], ['Timing', 'timing'],
  ['Profile research', 'research'], ['Questions to take forward', 'questions'],
] as const;

export function replayDisclosure(mode: 'scripted' | 'audio' = 'scripted') {
  return `QA ${mode === 'audio' ? 'audio' : 'transcript'} replay · ${mode === 'scripted' ? 'Scripted suggestions · ' : ''}Simulated role approvals · Not a sent client brief`;
}

export function renderHandoff(snapshot: BriefSnapshot, replay = false, mode: 'scripted' | 'audio' = 'scripted') {
  const { fields } = snapshot;
  const parts = ['AI Tinkerers · TALENT', `# ${fields.name}`, `${fields.title}${fields.company ? ` · ${fields.company}` : ''}`,
    replay ? replayDisclosure(mode) : 'Shared candidate brief · Reviewed by the candidate and recruiter',
    `Based in: ${fields.location || 'To discuss'}  \nExperience: ${fields.experience || 'To discuss'}  \nAvailability: ${fields.availability || 'To discuss'}`];
  for (const [title, field] of handoffSections) {
    if (field === 'research' && !fields.research) continue;
    parts.push(`## ${title}`, field === 'work' && fields.workTitle ? `### ${fields.workTitle}` : '', fields[field] || 'To discuss');
  }
  const materials = snapshot.studio.assets.filter((asset) => asset.included);
  if (materials.length) parts.push('## Work samples & materials',...materials.map((asset) => [
    `### ${asset.title}`,asset.url || (asset.fileId ? `Attached file: ${asset.title}` : ''),asset.text,asset.caption,
  ].filter(Boolean).join('\n\n')));
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

export function renderEvidencePacket(snapshot: BriefSnapshot, revision: string, replay = false, mode: 'scripted' | 'audio' = 'scripted') {
  return { kind: 'open-brief-evidence', revision, disclosure: replay ? replayDisclosure(mode) : 'Sources for the jointly reviewed brief', ...snapshot };
}
