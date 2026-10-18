import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { BriefSnapshot } from '@present/contracts/interviews';
import type { InterviewAsset } from '@present/contracts/interview-studio';
import { replayDisclosure } from './handoff';
import { renderPrintMaterials } from './print-materials';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function renderPrintHandoff(snapshot: BriefSnapshot, replay = false, mode: 'scripted' | 'audio' = 'scripted', loadFile?: (asset: InterviewAsset) => Uint8Array) {
  const fields = snapshot.fields;
  const value = (field: keyof typeof fields) => escapeHtml(fields[field] || 'To discuss');
  const asset = path.join(process.cwd(), 'public', 'interview-assets', 'ai-tinkerers.png');
  const logo = fs.existsSync(asset) ? `<span class="logo"><img alt="AI Tinkerers" src="data:image/png;base64,${fs.readFileSync(asset).toString('base64')}"></span>` : '<strong>AI TINKERERS</strong>';
  const section = (heading: string, content: string) => `<section><h2>${heading}</h2>${content}</section>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${value('name')} · AI Tinkerers candidate brief</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f2f4f7;color:#142a42;font:14px/1.6 Arial,Helvetica,sans-serif}article{max-width:860px;margin:28px auto;background:white;padding:28px 36px 34px;border:1px solid #e0e5ed;border-radius:5px}p,h1,h2{margin:0}p{white-space:pre-wrap}h1{font-size:36px;line-height:1.12;letter-spacing:-.04em;color:#142a42;margin-top:17px}h2{font-size:21px;line-height:1.3;letter-spacing:-.025em;margin-bottom:8px;color:#142a42}.role{font-size:18px;color:#3e5571;font-weight:500;margin-top:5px}.letterhead{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid #dfe4ec;gap:20px}.brand{display:flex;align-items:center;gap:18px}.brand>strong{font-size:11px;letter-spacing:.08em}.letterhead>span{font-size:10px}.logo{position:relative;display:block;width:165px;height:36px;overflow:hidden}.logo img{position:absolute;width:184.47px;max-width:none;height:auto;left:-9.4px;top:-13.86px}.intro{display:grid;grid-template-columns:32% minmax(0,1fr);gap:22px;margin:24px 0}.career{border-right:1px solid #e3ebf1;padding-right:20px}.career p{font-size:13px;margin-top:10px}.career span,.practical span{display:block;font-size:11px;color:#698093;margin-bottom:2px}section{border-top:1px solid #dfe4ec;padding-top:13px;margin-top:20px}.work-title{font-weight:700;margin-bottom:5px}.practical{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:14px;font-size:13px}footer{display:flex;justify-content:space-between;gap:15px;font-size:10px;color:#718593;border-top:1px solid #dfe4ec;margin-top:38px;padding-top:12px}.qa{max-width:860px;margin:20px auto;padding:10px 14px;background:#faf8f1;color:#776637;font-size:11px}@media(max-width:700px){article{margin:0;padding:22px}.intro{grid-template-columns:1fr}.career{border:0}.practical{grid-template-columns:1fr}h1{font-size:34px}.letterhead{flex-wrap:wrap}}@media print{@page{size:A4;margin:16mm}body{background:white}article{margin:0;padding:0;max-width:none;border:0;border-radius:0}h1{font-size:34px}h2{font-size:17px}body{font-size:12px}.role{font-size:17px}.career p{font-size:12px}.practical{font-size:11px}section{break-inside:avoid}.qa{margin:0 0 12px;padding:0;background:white}}
    </style>${replay ? `<aside class="qa">${escapeHtml(replayDisclosure(mode))}</aside>` : ''}<article>
    <div class="letterhead"><div class="brand">${logo}<strong>TALENT</strong></div><span>${value('company')} | CANDIDATE BRIEF</span></div>
    <h1>${value('name')}</h1><p class="role">${value('title')}</p>
    <div class="intro"><aside class="career"><h2>Career snapshot</h2><p><span>Based in</span>${value('location')}</p><p><span>Experience</span>${value('experience')}</p><p><span>Availability</span>${value('availability')}</p></aside><div><h2>Interview summary</h2><p>${value('story')}</p></div></div>
    ${section(/infra/i.test(fields.title) ? 'Infrastructure and engineering approach' : 'Engineering and delivery', `${fields.workTitle ? `<p class="work-title">${value('workTitle')}</p>` : ''}<p>${value('work')}</p>`)}
    ${section('AI-assisted delivery', `<p>${value('aiWork')}</p>`)}
    ${section('Interest and practical alignment', `<p>${value('motivation')}</p><div class="practical"><p><span>Compensation</span>${value('compensation')}</p><p><span>Working arrangements</span>${value('workplace')}</p><p><span>Timing</span>${value('timing')}</p></div>`)}
    ${fields.research ? section('Profile research', `<p>${value('research')}</p>`) : ''}${section('Questions to take forward', `<p>${value('questions')}</p>`)}
    ${renderPrintMaterials(snapshot,loadFile)}<style>.materials{break-inside:auto}.materials figure{margin:18px 0;padding:16px 0;border-top:1px solid #dfe4ec;break-inside:avoid}.materials h3{font-size:15px;margin:0 0 10px}.materials img{display:block;width:100%;max-height:420px;object-fit:contain;margin:12px 0}.materials a{display:inline-block;font-size:12px;color:#435f9a;margin-top:10px;overflow-wrap:anywhere}.materials figcaption{font-size:12px;color:#6d8097;margin:8px 0}</style>
    <footer><span>AI Tinkerers | ${value('company')} | ${value('name')}</span><span>Shared candidate brief</span></footer></article></html>`;
}
