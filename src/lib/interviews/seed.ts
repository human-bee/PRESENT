import * as Y from 'yjs';
import type { BriefProfile } from '@present/contracts/interviews';
import { addBriefActivity, editBriefField, setBriefSource } from './document';

export const exampleProfile: BriefProfile = {
  name: 'Jordan Lee', title: 'Founding Product Engineer', company: 'Northstar',
  roleContext: 'An example early-stage team building developer tools. The role combines hands-on engineering with product decisions. Confirm the actual scope, compensation, runway, and working arrangements together.',
  research: '', sourceUrl: '',
};

export function createBriefDocument(profile: BriefProfile, example: boolean) {
  const doc = new Y.Doc();
  doc.getMap('studio').set('scene', 'meet');
  doc.getMap('studio').set('focus', 'work');
  for (const field of ['name', 'title', 'company', 'roleContext'] as const) {
    editBriefField(doc, field, profile[field]);
  }
  if (profile.research) {
    editBriefField(doc, 'research', profile.research);
    setBriefSource(doc, 'research', { kind: 'research', label: 'Profile research · Not yet confirmed', statement: profile.research, url: profile.sourceUrl || undefined });
  }
  if (profile.sourceUrl) {
    const id = crypto.randomUUID();
    const linkedin = new URL(profile.sourceUrl).hostname.replace(/^www\./,'') === 'linkedin.com';
    doc.getMap('assets').set(id,{ id,kind: linkedin ? 'linkedin' : 'link',title: linkedin ? 'LinkedIn' : 'Research source',url: profile.sourceUrl,
      text: '',caption: '',field: 'research',included: false,x: 30,y: 80,createdBy: 'recruiter',createdAt: Date.now() });
  }
  if (example) {
    const values = {
      location: 'San Francisco', experience: '8 years',
      story: 'Product-minded engineer who takes ideas from a messy first sketch to something people use.',
      workTitle: 'Built the first developer platform at Atlas',
      work: 'Led end to end from early prototype to general availability, giving external developers a simple way to build on top of Atlas products.',
    };
    for (const [field, value] of Object.entries(values)) editBriefField(doc, field as keyof typeof values, value);
    setBriefSource(doc, 'story', { kind: 'research', label: 'Profile research · Not yet confirmed' });
    setBriefSource(doc, 'work', { kind: 'research', label: 'Profile research' });
    doc.getMap('transcripts').set('example-quote', {
      id: 'example-quote', speaker: 'Jordan', timestamp: Date.now(), example: true,
      text: 'I want to be closer to the product decisions, not just the implementation.',
    });
    doc.getMap('suggestions').set('example-suggestion', {
      id: 'example-suggestion', field: 'motivation', text: 'Looking for ownership of product decisions.',
      quote: 'I want to be closer to the product decisions, not just the implementation.',
      transcriptId: 'example-quote', status: 'pending',
    });
  }
  addBriefActivity(doc, example ? 'Example interview created. All people and companies are fictional.' : 'Shared brief created.');
  return doc;
}
