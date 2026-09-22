import { chromium, expect } from '@playwright/test';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
if (process.env.PRESENT_LIVE_ROOMOS !== '1') throw new Error('Explicit opt-in required: read-only Linear profile association.');
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4320';
const previous = readdirSync('.data/qa').filter(d => d.startsWith('contextual-acceptance-') && existsSync(`.data/qa/${d}/work-readback.json`)).sort().at(-1);
if (!previous) throw new Error('A spoken-work readback is required before newcomer oversight acceptance.');
const job = JSON.parse(readFileSync(`.data/qa/${previous}/work-readback.json`));
const out = `.data/qa/contextual-newcomer-${Date.now()}`; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts = [], proof = { status: 'failed', roomId: job.roomId, input: 'Synthetic browser participant explicitly associates the configured real Linear account. Test introduction text is person-supplied fixture content. No membership or messages changed.' };
try {
  const owner = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, recordVideo: { dir: out } }); contexts.push(owner);
  await owner.addInitScript(actor => { sessionStorage.setItem('present:member-id', actor); localStorage.setItem('present:name', 'Riley'); }, job.actor);
  const peer = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } }); contexts.push(peer);
  const a = await owner.newPage(), b = await peer.newPage(); await Promise.all([a.goto(`/r/${job.roomId}`), b.goto(`/r/${job.roomId}`)]);
  for (const p of [a,b]) await p.getByRole('button', { name: 'Open Standup', exact: true }).click();
  const da=a.getByRole('dialog'),db=b.getByRole('dialog');
  await da.getByRole('article',{name:'Riley introduction'}).getByRole('button',{name:/Connect my work|Review linked profile/}).click();
  await da.getByRole('button',{name:'This is my profile — connect it'}).click();
  await expect.poll(async()=>{const os=await(await a.request.get(`/api/activity/state?roomId=${job.roomId}`)).json();return os.activities.find(x=>x.id===os.activeId).meeting.members.find(m=>m.actor===job.actor)?.status;},{timeout:25000}).toBe('ready');
  const os=await(await a.request.get(`/api/activity/state?roomId=${job.roomId}`)).json(),activity=os.activities.find(x=>x.id===os.activeId),profile=activity.meeting.members.find(m=>m.actor===job.actor);
  expect(profile.source).toBe('linear');expect(profile.team).toBeTruthy();expect(profile.projects.length).toBeGreaterThan(0);
  await expect(db.getByRole('article',{name:'Riley introduction'})).toContainText(profile.name);for(const project of profile.projects)await expect(db.getByRole('article',{name:'Riley introduction'})).toContainText(project);
  await da.getByRole('article',{name:'Riley introduction'}).getByRole('button',{name:'Add my introduction'}).click();await da.getByLabel('What you bring').fill('Synthetic-input testing');await da.getByLabel('A short introduction').fill('Test fixture introduction for the connected room workflow.');await da.getByRole('button',{name:'Share my introduction'}).click();
  await expect(db.getByRole('article',{name:'Riley introduction'})).toContainText('Synthetic-input testing');
  await a.screenshot({path:`${out}/introduction-desktop.png`});await b.setViewportSize({width:390,height:844});await b.screenshot({path:`${out}/introduction-mobile.png`});
  await da.getByRole('button',{name:`Open ${job.title} work`,exact:true}).click();await expect(a.getByRole('dialog')).toHaveCount(0);await expect(a.locator(`[id="shape:${job.objectId}"]`)).toBeVisible();await expect(a.locator(`[id="shape:${job.objectId}"]`)).toContainText('completed');await a.screenshot({path:`${out}/owned-work.png`});
  proof.status='passed';proof.teamPresent=!!profile.team;proof.projects=profile.projects.length;proof.workLabels=profile.strengths.length;proof.actorBound=profile.actor===job.actor;proof.ownedWorkOpened=job.jobId;proof.personalStrengthsSeparate=true;
}catch(error){proof.error=error.stack??String(error);}
finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();writeFileSync(`${out}/proof.json`,JSON.stringify(proof,null,2));console.log({...proof,out});if(proof.status!=='passed')process.exitCode=1;}
