import type { CapabilityKind } from '../../shared/capabilities';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { appendFile, writeFile, readFile } from 'node:fs/promises';
config({path:'.env.local'});
const { decide } = await import('./decisions');
const { stories } = await import('./stories');
const { makeObject } = await import('../../shared/room');
const { createCapability } = await import('../../src/widgets/packs');
const stamp = new Date().toISOString().replaceAll(':','-');
const path = `docs/benchmarks/${stamp}.jsonl`;
const base = 'http://127.0.0.1:4317';
let saved: Record<string,string> = {};
try { saved=JSON.parse(await readFile('.data/benchmark-rooms.json','utf8')); } catch { /* Fresh checkout. */ }
const rooms = Object.fromEntries(stories.map((story,index) => [story.name,Object.fromEntries(['jev','luna'].map(engine => [engine,saved[`${engine}:${index}`] ?? randomBytes(16).toString('hex')]))]));
const health = await fetch(`${base}/api/health`);
if (!health.ok) throw new Error('Local PRESENT server must be healthy before benchmarking.');
const start = Date.now();
const interval = process.argv.includes('--quick') ? 0 : 66000;
await writeFile(path,JSON.stringify({type:'run',startedAt:new Date(start).toISOString(),synthetic:true,intervalMs:interval,rooms,blocked:{cerebras:'HTTP 402: billing credit required'},timingBoundary:'model plus HTTP operation commit; browser paint not measured'})+'\n');
console.log(JSON.stringify({path,rooms}));
for (let step=0;step<6;step++) {
 const delay=start+step*interval-Date.now();
 if(delay>0) await new Promise(resolve=>setTimeout(resolve,delay));
 for (const story of stories) for (const engine of ['jev','luna'] as const) {
  const input=story.steps[step], roomId=rooms[story.name][engine], began=performance.now();
  try {
   const result=await decide(input.prompt,engine);
   const correct=result.route===input.expected && (input.seconds===undefined || result.seconds===input.seconds) && (input.text===undefined || result.text===input.text);
   let objectId: string|undefined;
   // A wrong decision is recorded without executing it; benchmark rooms contain synthetic content only.
   if(correct && result.route!=='defer') {
    const position={x:engine==='jev'?0:500,y:step*440};
    const object=result.route==='timer' ? makeObject('timer',input.actor,position,{durationMs:result.seconds!*1000,remainingMs:result.seconds!*1000,endsAt:Date.now()+result.seconds!*1000}) : result.route==='note' ? makeObject('note',input.actor,position,{text:result.text}) : createCapability(result.route as CapabilityKind,input.actor,position);
    object.title=`${story.name} · ${engine} · ${input.actor}`;
    const response=await fetch(`${base}/api/room/${roomId}/operation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor:input.actor,requestId:randomBytes(16).toString('hex'),operation:{type:'put',object}})});
    if(!response.ok) throw new Error(`Canvas commit HTTP ${response.status}: ${await response.text()}`);
    const committed = await response.json();
    if (!committed.room?.objects?.some((item: {id: string}) => item.id === object.id)) throw new Error('Committed shape absent from room readback');
    objectId=object.id;
   }
   const record={type:'turn',story:story.name,step,engine,...input,expectedText:input.text,...result,correct,objectId,totalToCommitMs:Math.round(performance.now()-began),at:new Date().toISOString()};
   await appendFile(path,JSON.stringify(record)+'\n'); console.log(JSON.stringify(record));
  } catch(error) {const record={type:'error',story:story.name,step,engine,error:error instanceof Error?error.message:'unknown'};await appendFile(path,JSON.stringify(record)+'\n');console.log(JSON.stringify(record));}
 }
}
await appendFile(path,JSON.stringify({type:'complete',durationMs:Date.now()-start})+'\n');
console.log('COMPLETE '+path);process.exit(0);
