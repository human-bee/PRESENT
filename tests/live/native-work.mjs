import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const root = process.cwd(), out = resolve(root, 'docs/evidence/native-work-proof');
const baseURL = process.env.PRESENT_E2E_URL ?? 'http://127.0.0.1:4318';
assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d{4,5}$/);
mkdirSync(out, { recursive: true });
const save = (name, data) => writeFileSync(resolve(out, name), JSON.stringify(data, null, 2)+'\n');
const readbackOnly = process.argv.includes('--readback');
const continuing = readbackOnly || process.argv.includes('--continue-followup');
assert.equal(existsSync(resolve(out, 'budget.json')), continuing, 'Existing budget prevents an accidental paid rerun.');
const previous = continuing ? JSON.parse(readFileSync(resolve(out, 'summary.json'), 'utf8')) : null;
if (continuing) assert.equal(JSON.parse(readFileSync(resolve(out, 'budget.json'), 'utf8')).requestsStarted, readbackOnly ? 2 : 1);
const report = { at: new Date().toISOString(), baseURL, roomId: randomBytes(16).toString('hex'), provider: 'spark', maxTurns: 2, requestsStarted: 0, status: 'running', separateBrowserContexts: true, physicalDevices: false };
if (previous) { report.roomId = previous.roomId; report.requestsStarted = previous.requestsStarted; report.initialHarnessFailure = previous.error; }
const prior = continuing ? readdirSync(resolve(root, '.data/work-jobs')).filter(n => /^[a-f0-9]{32}\.json$/.test(n)).map(n => JSON.parse(readFileSync(resolve(root, '.data/work-jobs', n), 'utf8'))).find(j => j.roomId === report.roomId && j.requestId === 'native-work-initial') : null;
const reserve = () => { report.requestsStarted++; assert.ok(report.requestsStarted <= 2); save('budget.json', { requestsStarted: report.requestsStarted, maxTurns: 2 }); };
const get = async path => { const r=await fetch(baseURL+path); assert.equal(r.status,200);return r.json(); };
const waitJob = async id => { for(let n=0;n<130;n++){const job=await get(`/api/work/${id}?roomId=${report.roomId}`);if(!['queued','running'].includes(job.status)){assert.equal(job.status,'completed',job.error??job.status);return job;}await new Promise(r=>setTimeout(r,1000));}throw Error('Work job timed out'); };
const inspect = job => { const stored=JSON.parse(readFileSync(resolve(root,'.data/work-jobs',job.jobId+'.json'),'utf8')); const workspace=resolve(root,'.data/work-jobs/workspaces',stored.executionState.workspaceId,'files'); for(const file of job.execution.files){const bytes=readFileSync(resolve(workspace,file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);} assert.ok(job.execution.commands.some(c=>c.exitCode===0&&c.status==='completed')); const paths=globSync(`sessions/**/rollout-*-${stored.executionState.threadId}.jsonl`,{cwd:process.env.CODEX_HOME??resolve(homedir(),'.codex')}); assert.equal(paths.length,1);const events=readFileSync(resolve(process.env.CODEX_HOME??resolve(homedir(),'.codex'),paths[0]),'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(e=>e.type==='response_item').map(e=>e.payload);assert.ok(job.execution.commands.some(c=>{const call=events.find(e=>e.type==='function_call'&&e.call_id===c.id);const output=events.find(e=>e.type==='function_call_output'&&e.call_id===c.id);return JSON.stringify(call).includes('node --test math.test.mjs')&&/fail 0/.test(JSON.stringify(output))&&/pass [1-9]/.test(JSON.stringify(output));}));assert.ok(job.execution.files.some(f=>f.path==='math.mjs'));assert.ok(job.execution.files.some(f=>f.path==='math.test.mjs'));return stored.executionState; };
const publicJob = job => ({jobId:job.jobId,objectId:job.objectId,status:job.status,artifactIds:job.artifactIds,execution:job.execution});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:1440,height:1000}})]);
 if(prior) await contexts[0].addInitScript(actor=>sessionStorage.setItem('present:member-id',actor),prior.actor);
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 await Promise.all([a.goto(`${baseURL}/r/${report.roomId}`),b.goto(`${baseURL}/r/${report.roomId}`)]);
 await expect(a.locator('.person')).toHaveCount(2);
 const actor=await a.evaluate(()=>sessionStorage.getItem('present:member-id'));
 assert.notEqual(actor,await b.evaluate(()=>sessionStorage.getItem('present:member-id')));
 let initial;
 if (prior) initial = await waitJob(prior.jobId);
 else {
 reserve();
 const r=await fetch(baseURL+'/api/work/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:report.roomId,actor,requestId:'native-work-initial',provider:'spark',title:'Tested math module',position:{x:100,y:100},prompt:'Create math.mjs exporting add(a,b) that returns their sum, plus math.test.mjs using node:test and node:assert/strict with tests for positive, negative, and zero inputs. Run node --test math.test.mjs and fix failures. No dependencies. Return a concise Markdown deliverable describing the function and actual test result.'})});
 assert.equal(r.status,202);initial=await waitJob((await r.json()).jobId);}
 const firstState=readbackOnly ? prior.executionState : inspect(initial);report.initial=publicJob(initial);report.initialActualTestsPassed=true;save('progress.json',report);
 for(const page of [a,b]){page.setDefaultTimeout(10000);await page.getByRole('button',{name:'Fit everything'}).click();await expect(page.getByRole('region',{name:'Work card'}).getByRole('status')).toHaveText('completed');}
 let follow;
 if(readbackOnly){const room=(await get(`/api/room/${report.roomId}`)).room;follow=await waitJob(room.objects.find(o=>o.id===initial.objectId).data.work.jobId);}
 else {
 await a.getByLabel('Work follow-up',{exact:true}).fill('Continue the existing files. Change add(a,b) to clamp negative sums to zero, preserving positive sums. Update math.test.mjs with assertions for negative sum clamping, positive sums, and zero. Run node --test math.test.mjs as a separate final command tool call (not bundled with file creation), and fix failures. Return a concise Markdown artifact stating the new behavior and actual test result.');
 reserve();const pending=a.waitForResponse(r=>new URL(r.url()).pathname==='/api/work/start'&&r.request().method()==='POST');await a.getByRole('button',{name:'Continue work',exact:true}).click();const followResponse=await pending;assert.equal(followResponse.status(),202);
 const room=(await get(`/api/room/${report.roomId}`)).room;follow=await waitJob(room.objects.find(o=>o.id===initial.objectId).data.work.jobId);}
 const nextState=inspect(follow);assert.equal(follow.objectId,initial.objectId);assert.equal(nextState.workspaceId,firstState.workspaceId);assert.equal(nextState.threadId,firstState.threadId);assert.equal(follow.execution.continued,true);assert.notEqual(follow.execution.files.find(f=>f.path==='math.mjs').sha256,initial.execution.files.find(f=>f.path==='math.mjs').sha256);report.followup=publicJob(follow);report.followupActualTestsPassed=true;report.sameWorkspace=true;report.samePrivateThread=true;report.followupViaRealUI=true;
 const shapes=page=>page.locator('.tl-shape[data-shape-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-shape-id')).sort());
 await expect.poll(async()=>JSON.stringify(await shapes(a))).toBe(JSON.stringify(await shapes(b)));
 const canonical=await shapes(a);await b.reload();await expect.poll(async()=>JSON.stringify(await shapes(b))).toBe(JSON.stringify(canonical));report.peersAndReloadMatch=true;report.peerShapeCount=canonical.length;assert.equal(canonical.length,3);
 for(const [name,page]of[['initiator',a],['peer',b]]){await page.getByRole('button',{name:'Fit everything'}).click();await page.screenshot({path:resolve(out,name+'.png')});}
 const room=(await get(`/api/room/${report.roomId}`)).room;
 for(const id of [...initial.artifactIds,...follow.artifactIds]){const artifact=room.objects.find(o=>o.id===id);assert.ok(artifact?.data.state?.markdown?.length>30);const title=artifact.title;for(const page of[a,b]){const frame=page.frameLocator(`iframe[title=${JSON.stringify(title)}]`);await expect(frame.locator('#content')).toHaveText(artifact.data.state.markdown);}}
 report.sharedArtifactsRendered=true;report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{await browser.close();report.endedAt=new Date().toISOString();save('summary.json',report);console.log(JSON.stringify(report));}
