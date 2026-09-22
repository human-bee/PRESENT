import { chromium, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeSpeech, installSyntheticMicrophone } from './context-audio-fixture.mjs';
if (process.env.PRESENT_LIVE_ROOMOS !== '1') throw new Error('Explicit opt-in required: real provider calls and two synthetic voice sessions.');
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4320';
const out = `.data/qa/contextual-acceptance-${Date.now()}`, roomId = randomBytes(16).toString('hex'); mkdirSync(out, { recursive: true });
const lines = {
  red: 'I think red Ferraris look much better than yellow ones.',
  yellow: 'Yellow is more fun. That one feels like summer.',
  third: 'We could also compare a blue Ferrari, although yellow is still my favorite.',
  bridge: 'Let us change the topic to the Golden Gate Bridge. Its main span is twice as long as one side span. Can we compare those span lengths in feet?',
  correction: 'Actually, I meant nearly four times as long, not twice. Let us check the actual numbers.',
  blocker: 'Alex, your export contract is the thing blocking my parser task. Is the export contract finished?',
  resolved: 'Oh I actually completed that yesterday, that should be unblocked now.',
};
const audio = Object.fromEntries(Object.entries(lines).map(([name, text]) => [name, makeSpeech(out, name, text)]));
const proof = { roomId, at: new Date().toISOString(), input: 'Two independent browser participants, synthetic microphone input only. Actual Realtime, contextual interpretation, web research and Codex providers. No preseeded room state.', lines, steps: [], status: 'running' };
const save = () => writeFileSync(`${out}/proof.json`, JSON.stringify(proof, null, 2)); save();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const contexts = [], pages = []; const deadline = setTimeout(() => void browser.close(), 300000);
try {
  for (const name of ['Alex', 'Riley']) { const c=await browser.newContext({baseURL,viewport:{width:1440,height:1000},recordVideo:{dir:out,size:{width:1440,height:1000}}}); contexts.push(c);await c.addInitScript(n=>localStorage.setItem('present:name',n),name);await c.addInitScript(installSyntheticMicrophone);const p=await c.newPage();p.setDefaultTimeout(10000);pages.push(p); }
  const [a,b]=pages;await Promise.all(pages.map(p=>p.goto(`/r/${roomId}`)));for(const p of pages)await expect(p.locator('.room-status')).toHaveText('here, together');
  const state=async()=>{const r=await a.request.get(`/api/activity/state?roomId=${roomId}`);if(!r.ok())throw new Error('State read failed');return r.json();};
  const active=async()=>{const os=await state();return os.activities.find(x=>x.id===os.activeId);};
  const joinActivity=async(label)=>{await a.getByRole('button',{name:'◈ Activities',exact:true}).click();await a.locator('.activity-template-grid button').filter({has:a.getByText(label,{exact:true})}).click();if(await b.getByRole('dialog').count())await b.getByRole('button',{name:'Back to canvas ↙',exact:true}).click();await b.getByRole('button',{name:`Open ${label}`,exact:true}).click();};
  const standupOnly=process.env.ROOMOS_STORY==='standup';const start=Date.now();await joinActivity(standupOnly?'Standup':'Debate');proof.setupMs=Date.now()-start;
  for(const p of pages){await p.getByRole('button',{name:'Turn microphone on',exact:true}).click();await expect(p.getByRole('button',{name:'Turn microphone off',exact:true})).toBeVisible({timeout:20000});await p.getByRole('button',{name:'Start listening',exact:true}).click();await expect(p.getByRole('button',{name:'Show voice transcript'})).toContainText('Following your voice',{timeout:30000});}
  const speak=async(p,key)=>{const before=(await active()).utterances.length;const timing=await p.evaluate(bytes=>window.__contextAudio.play(bytes),audio[key]);await expect.poll(async()=> (await active()).utterances.length,{timeout:25000}).toBeGreaterThan(before);const u=(await active()).utterances.at(-1);proof.steps.push({key,timing,transcript:u.text,source:u.source,speaker:u.speakerName});save();return timing;};
  if(!standupOnly){
  await a.evaluate(() => { window.__visibleRoomOutput = {}; const read = () => { const clip=document.querySelector('.activity-focus .activity-body')?.getBoundingClientRect(); const visible=e=>{const r=e.getBoundingClientRect();return clip&&r.width>0&&r.top>=clip.top&&r.bottom<=clip.bottom;};const thoughts=[...document.querySelectorAll('.activity-focus .ambient-thought>p')].filter(visible);const photos=[...document.querySelectorAll('.activity-focus .perspective img')].filter(e=>visible(e)&&e.complete&&e.naturalWidth>0);const t=performance.timeOrigin+performance.now();if(thoughts.length)window.__visibleRoomOutput.thought??=t;if(photos.length>=2)window.__visibleRoomOutput.photos??=t;if(!window.__visibleRoomOutput.photos)requestAnimationFrame(read);};requestAnimationFrame(read); });
  const red=await speak(a,'red');const da=a.getByRole('dialog'),db=b.getByRole('dialog');
  await expect.poll(async()=> (await active()).observations.filter(o=>o.kind==='preference').length,{timeout:30000}).toBeGreaterThan(0);proof.preferenceCommittedMs=Date.now()-red.lastAudible;
  const visibleImages=()=>da.locator('.perspective .activity-visuals img').evaluateAll(images=>images.filter(i=>i.getBoundingClientRect().width>0).map(i=>({title:i.alt,decoded:i.complete&&i.naturalWidth>0})));
  await expect.poll(async()=>{const images=await visibleImages();return images.length>=2&&images.every(i=>i.decoded);},{timeout:35000}).toBe(true);proof.imagesVisibleMs=Date.now()-red.lastAudible;proof.visibleOutput=await a.evaluate(()=>window.__visibleRoomOutput);if(proof.visibleOutput.photos)proof.firstVisiblePhotosMs=proof.visibleOutput.photos-red.lastAudible;
  await speak(b,'yellow');await expect.poll(async()=> (await active()).seats.filter(s=>s.sideId!==null).length,{timeout:30000}).toBe(2);
  await a.screenshot({path:`${out}/two-perspectives.png`});proof.debate=(await active());save();
  await speak(b,'third');await expect.poll(async()=> (await active()).sides.length,{timeout:30000}).toBeGreaterThanOrEqual(3);await a.screenshot({path:`${out}/third-perspective.png`});
  await speak(a,'bridge');await expect.poll(async()=> {const x=await active();return x.claims.filter(c=>c.epoch===x.epoch&&c.utteranceId===x.utterances.at(-1)?.id).length;},{timeout:30000}).toBeGreaterThan(0);
  const bridgeState=await active();const bridgeClaim=bridgeState.claims.find(c=>c.epoch===bridgeState.epoch&&c.utteranceId===bridgeState.utterances.at(-1).id);await speak(a,'correction');await expect.poll(async()=> (await active()).claims.find(c=>c.id===bridgeClaim.id)?.version??0,{timeout:30000}).toBeGreaterThan(1);
  await expect.poll(async()=> (await active()).charts.filter(c=>c.provenance==='source-extracted').length,{timeout:70000}).toBeGreaterThan(0);
  const afterBridge=await active();const chart=afterBridge.charts.find(c=>c.provenance==='source-extracted');expect(chart.values.map(v=>v.value).sort((x,y)=>x-y)).toEqual([1125,4200]);expect(chart.sourceRows.every(r=>r.quote.includes(r.valueText)&&r.pageHash)).toBe(true);proof.chart=chart;proof.correctedClaim=afterBridge.claims.find(c=>c.id===bridgeClaim.id);
  await da.locator('.ambient-data-card').last().scrollIntoViewIfNeeded();await a.screenshot({path:`${out}/source-chart.png`});await b.setViewportSize({width:390,height:844});await db.locator('.ambient-data-card').last().scrollIntoViewIfNeeded();await b.screenshot({path:`${out}/mobile-data.png`});await b.setViewportSize({width:1440,height:1000});save();
  }
  if(!standupOnly)await joinActivity('Standup');await expect.poll(async()=> (await active()).seats.length).toBe(2);const sa=a.getByRole('dialog'),sb=b.getByRole('dialog');
  await sa.getByRole('button',{name:'+ Blocker',exact:true}).click();await sa.getByLabel('Blocker',{exact:true}).fill('Finish export contract');await sa.getByRole('button',{name:'Track blocker'}).click();
  await sa.getByRole('button',{name:'+ Blocker',exact:true}).click();await sa.getByLabel('Blocker',{exact:true}).fill('Prepare deployment checklist');await sa.getByRole('button',{name:'Track blocker'}).click();
  await sb.getByRole('button',{name:'+ Dependent work'}).click();await sb.getByLabel('Deliverable title').fill('Build the export parser');await sb.getByLabel('Exact work for Codex').fill('Create parse-export.cjs exporting parseExport(text), accepting a JSON string whose value is an array of objects with nonempty string id. Return the parsed array. Reject invalid JSON, non-arrays and missing or blank ids. Create parse-export.test.cjs with node:test covering valid and invalid cases. Run node --test parse-export.test.cjs and report actual files and test results.');await sb.getByRole('checkbox',{name:'Finish export contract'}).check();await sb.getByRole('button',{name:'Prepare commitment'}).click();await sb.getByRole('button',{name:'Authorize automatic start'}).click();
  await speak(b,'blocker');await expect.poll(async()=> (await active()).utterances.at(-1)?.extraction,{timeout:30000}).toBe('done');
  const resolved=await speak(a,'resolved');await expect(sb.locator('.meeting-execution')).toBeVisible({timeout:45000});proof.spokenWorkVisibleMs=Date.now()-resolved.lastAudible;
  await expect.poll(async()=> (await active()).meeting.commitments[0].status,{timeout:100000}).toBe('completed');proof.spokenWorkCompletedMs=Date.now()-resolved.lastAudible;
  const meeting=await active();const job=await(await a.request.get(`/api/work/${meeting.meeting.commitments[0].jobId}?roomId=${roomId}`)).json();expect(job.execution.commands.some(c=>c.command.includes('--test')&&c.exitCode===0)).toBe(true);proof.work={job,blockers:meeting.meeting.blockers};
  await sb.locator('.meeting-execution').scrollIntoViewIfNeeded();await b.screenshot({path:`${out}/spoken-work.png`});
  proof.media = await Promise.all(pages.map(p=>p.evaluate(async()=>{const trackIds=[...document.querySelectorAll('audio')].flatMap(e=>e.srcObject?.getAudioTracks?.().map(t=>t.id)??[]);const inbound=[];for(const pc of window.__contextPeers){const stats=await pc.getStats();for(const r of stats.values())if(r.type==='inbound-rtp'&&r.kind==='audio')inbound.push({roomAudio:trackIds.includes(r.trackIdentifier),samples:r.totalSamplesReceived??r.jitterBufferEmittedCount??0,energy:r.totalAudioEnergy??0});}return {roomAudioTracks:trackIds.length,inbound};})));
  expect(proof.media.every(m=>m.roomAudioTracks>0&&m.inbound.some(r=>r.samples>0))).toBe(true);
  for(const p of pages){await p.getByRole('button',{name:'Stop listening',exact:true}).click();await p.getByRole('button',{name:'Turn microphone off',exact:true}).click();}
  await expect.poll(()=>Promise.all(pages.map(p=>p.evaluate(()=>window.__contextAudio.tracks.every(t=>t.readyState==='ended')))),{timeout:10000}).toEqual([true,true]);proof.captureStopped=[true,true];
  await Promise.all(pages.map(p=>p.reload()));for(const p of pages)await expect(p.locator('.room-status')).toHaveText('here, together');await expect(b.getByRole('dialog').locator('.commitment-card')).toContainText('completed');proof.reload=true;proof.status='passed';
}catch(error){proof.status='failed';proof.error=error.stack??String(error);for(const[i,p]of pages.entries())if(!p.isClosed())await p.screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});}
finally{clearTimeout(deadline);await Promise.all(contexts.map(c=>c.close()));await browser.close();save();console.log(JSON.stringify({out,status:proof.status,error:proof.error,steps:proof.steps.map(x=>x.key),preferenceVisibleMs:proof.preferenceVisibleMs,imagesVisibleMs:proof.imagesVisibleMs,spokenWorkVisibleMs:proof.spokenWorkVisibleMs}));if(proof.status!=='passed')process.exitCode=1;}
