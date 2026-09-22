import type { CapabilityKind } from '../shared/capabilities';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { json } from './http';
import { decide } from '../scripts/benchmarks/decisions';
import { stories } from '../scripts/benchmarks/stories';
import { makeObject } from '../shared/room';
import { createCapability } from '../src/widgets/packs';
import { applyOperation } from './room-store';
const active = new Set<string>();
const rooms = new Map<string,string>();
try { for (const [key,value] of Object.entries(JSON.parse(readFileSync('.data/benchmark-rooms.json','utf8')))) if (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)) rooms.set(key,value); } catch { /* First run creates isolated rooms. */ }
/** Deliberately accepts fixture IDs only. Never accepts or reads private room prompts. */
export async function handleBenchmark(req: IncomingMessage, res: ServerResponse) {
 const url = new URL(req.url ?? '/', 'http://localhost');
 if (url.pathname !== '/api/benchmark') return false;
 if (req.method === 'GET') { json(res,200,{stories}); return true; }
 if (req.method !== 'POST') { json(res,405,{error:'Use POST'}); return true; }
 let raw=''; for await (const chunk of req) {raw+=chunk; if(raw.length>1000) {json(res,413,{error:'Too large'});return true;} }
 const parsed=z.object({engine:z.enum(['jev','luna','cerebras']),story:z.number().int().min(0).max(2),step:z.number().int().min(0).max(5)}).strict().safeParse(JSON.parse(raw));
 if(!parsed.success) {json(res,400,{error:'Select a synthetic fixture'});return true;}
 const {engine,story,step}=parsed.data;
 if(active.has(engine)) {json(res,429,{error:'This lane is running'});return true;}
 active.add(engine);
 try {
  const input=stories[story].steps[step], result=await decide(input.prompt,engine);
  const correct=result.route===input.expected && (input.seconds===undefined || result.seconds===input.seconds) && (input.text===undefined || result.text===input.text);
  const key=`${engine}:${story}`;
  const roomId=rooms.get(key) ?? randomBytes(16).toString('hex');rooms.set(key,roomId);
  writeFileSync('.data/benchmark-rooms.json',JSON.stringify(Object.fromEntries(rooms)),{mode:0o600});
  let objectId:string|undefined;
  if(correct && result.route!=='defer') {
   const position={x:100,y:160};
   const object=result.route==='timer' ? makeObject('timer',input.actor,position,{durationMs:result.seconds!*1000,remainingMs:result.seconds!*1000,endsAt:Date.now()+result.seconds!*1000}) : result.route==='note' ? makeObject('note',input.actor,position,{text:result.text}) : createCapability(result.route as CapabilityKind,input.actor,position);
   object.title=`${engine} · ${input.actor}`;
   applyOperation(roomId,{type:'put',object},input.actor,{requestId:randomBytes(16).toString('hex')});objectId=object.id;
  }
  json(res,200,{...result,correct,roomId,objectId,expected:input.expected});
 } catch(error) {json(res,502,{error:error instanceof Error?error.message:'Benchmark failed'});}
 finally {active.delete(engine);}
 return true;
}
