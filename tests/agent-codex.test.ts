import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { closeCodexSession, codexAvailability, codexThreadOptions, generateWithCodex } from '../server/agents/codex';
import { CodexWire, codexEnvironment } from '../server/agents/codex-wire';
import { agentModels } from '../server/agents/contract';

type Log = { method?: string; id?: number | string; params?: Record<string, unknown>; error?: unknown };
async function fixture(includeSpark = true) {
  await closeCodexSession();
  const directory = mkdtempSync(join(tmpdir(), 'present-codex-')); const ledger = join(directory, 'wire.jsonl');
  const command = join(directory, 'codex'); const previous = { cli: process.env.CODEX_CLI_PATH, home: process.env.CODEX_HOME };
  writeFileSync(join(directory, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }));
  writeFileSync(command, `#!/usr/bin/env node
const {createInterface}=require('node:readline'); const {appendFileSync}=require('node:fs');
const threads=new Map(); let next=0;
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const result=(id,result)=>send({id,result});
const event=(method,params)=>send({method,params});
createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line); appendFileSync(${JSON.stringify(ledger)},JSON.stringify(message)+'\\n');
 const {id,method,params}=message;
 if(method==='initialize') result(id,{});
 if(method==='account/read') result(id,{account:{type:'chatgpt'}});
 if(method==='model/list') result(id,{data:${JSON.stringify((includeSpark ? ['spark', 'codex'] : ['codex']).map(key => ({ model: agentModels[key as 'spark' | 'codex'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }] })))},nextCursor:null});
 if(method==='thread/start'){const threadId='thread-'+ ++next;threads.set(threadId,params.model);result(id,{thread:{id:threadId},model:params.model});}
 if(method==='turn/start'){
  const threadId=params.threadId, turnId='turn-'+threadId, prompt=params.input[0].text;
  if(prompt==='rpc-error'){send({id,error:{code:-32600,message:'private credential-like detail'}});return;}
  const finish=()=>{
   event('item/completed',{threadId:'other-room',turnId,item:{type:'agentMessage',text:'wrong-room'}});
   event('item/completed',{threadId,turnId:'old-turn',item:{type:'agentMessage',text:'wrong-turn'}});
   event('error',{threadId,turnId,willRetry:true,error:{message:'retrying'}});
   event('item/completed',{threadId,turnId,item:{type:'agentMessage',phase:'final_answer',text:prompt}});
   event('item/completed',{threadId,turnId,item:{type:'agentMessage',phase:'commentary',text:'ignore-commentary'}});
   event('turn/completed',{threadId,turn:{id:turnId,status:'completed'}});
  };
  if(prompt==='early'){finish();result(id,{turn:{id:turnId}});}else{result(id,{turn:{id:turnId}});if(prompt!=='cancel')setTimeout(finish,prompt==='slow'?35:2);}
 }
 if(method==='turn/interrupt') result(id,{});
 if(method==='thread/unsubscribe') {threads.delete(params.threadId);result(id,{status:'unsubscribed'});}
 if(method==='ask-host'){send({id:'host-tool',method:'command/exec',params:{command:'forbidden'}});result(id,{});}
 if(method==='die') process.exit(0);
});
`, { mode: 0o700 });
  process.env.CODEX_CLI_PATH = command; process.env.CODEX_HOME = directory;
  return { command, logs: (): Log[] => readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line)), async close() { await closeCodexSession(); if (previous.cli === undefined) delete process.env.CODEX_CLI_PATH; else process.env.CODEX_CLI_PATH = previous.cli; if (previous.home === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous.home; rmSync(directory, { recursive: true }); } };
}

test('Codex receives no host environment, credentials, tools or model fallback', () => {
  const previousKey = process.env.CEREBRAS_API_KEY;
  process.env.PRESENT_TEST_SECRET = 'private'; process.env.CEREBRAS_API_KEY = 'test-secret';
  try { assert.equal(codexEnvironment().PRESENT_TEST_SECRET, undefined); assert.equal(codexEnvironment().CEREBRAS_API_KEY, undefined); }
  finally { delete process.env.PRESENT_TEST_SECRET; if (previousKey === undefined) delete process.env.CEREBRAS_API_KEY; else process.env.CEREBRAS_API_KEY = previousKey; }
  const options = codexThreadOptions('spark');
  assert.equal(options.model, agentModels.spark); assert.equal(options.allowProviderModelFallback, false);
  assert.deepEqual(options.environments, []); assert.deepEqual(options.dynamicTools, []); assert.deepEqual(options.selectedCapabilityRoots, []);
  assert.equal(options.config.features.shell_tool, false); assert.equal(options.config.features.skip_host_skill_discovery, true);
});

test('warm Spark turns correlate early notifications by thread and turn and ignore retry errors', async () => {
  const fake = await fixture();
  try {
    const availability = await codexAvailability(); assert.equal(availability.spark, true); assert.equal(availability.codex, true); assert.equal(availability.providers.length, 4);
    const results = await Promise.all([generateWithCodex('early', AbortSignal.timeout(1000), 'spark'), generateWithCodex('slow', AbortSignal.timeout(1000), 'spark')]);
    assert.deepEqual(results, ['early', 'slow']);
    const logs = fake.logs();
    assert.equal(logs.filter(m => m.method === 'initialize').length, 1);
    assert.equal(logs.filter(m => m.method === 'thread/start').length, 2);
    assert.equal(logs.filter(m => m.method === 'thread/unsubscribe').length, 2);
    assert.ok(logs.filter(m => m.method === 'turn/start').every(m => m.params?.outputSchema && Array.isArray(m.params.environments) && m.params.environments.length === 0));
  } finally { await fake.close(); }
});

test('cancellation interrupts only its turn, then reuses the transport for the next request', async () => {
  const fake = await fixture();
  try {
    await codexAvailability();
    const controller = new AbortController(); const abort = setTimeout(() => controller.abort(), 100);
    await assert.rejects(generateWithCodex('cancel', controller.signal, 'spark'), /cancelled/); clearTimeout(abort);
    assert.equal(await generateWithCodex('retry', AbortSignal.timeout(1000), 'spark'), 'retry');
    const logs = fake.logs(); const turn = logs.find(m => m.method === 'turn/interrupt');
    assert.equal(turn?.params?.threadId, 'thread-1'); assert.equal(turn?.params?.turnId, 'turn-thread-1');
    assert.equal(logs.filter(m => m.method === 'initialize').length, 1); assert.equal(logs.filter(m => m.method === 'thread/unsubscribe').length, 2);
  } finally { await fake.close(); }
});

test('Spark unavailability is truthful and never silently substitutes Astra', async () => {
  const fake = await fixture(false);
  try {
    const availability = await codexAvailability(); assert.equal(availability.spark, false); assert.equal(availability.codex, true);
    await assert.rejects(generateWithCodex('hello', AbortSignal.timeout(1000), 'spark'), /gpt-5.3-codex-spark is not available/);
    assert.equal(fake.logs().filter(m => m.method === 'thread/start').length, 0);
  } finally { await fake.close(); }
});

test('RPC errors identify the failed operation, redact backend details, and release their thread', async () => {
  const fake = await fixture();
  try {
    await assert.rejects(generateWithCodex('rpc-error', AbortSignal.timeout(1000), 'spark'), error => error instanceof Error && error.message.includes('turn/start') && error.message.includes('-32600') && !error.message.includes('private'));
    assert.equal(fake.logs().filter(m => m.method === 'thread/unsubscribe').length, 1);
  } finally { await fake.close(); }
});

test('host tool requests fail closed and a dead stdin rejects without an unhandled EPIPE', async () => {
  const fake = await fixture(); const wire = new CodexWire(fake.command);
  try {
    await wire.request('initialize', {}); await wire.request('ask-host', {});
    await wire.request('initialize', {}); // Ensure the server processed the response to its tool request.
    assert.ok(fake.logs().some(m => m.id === 'host-tool' && m.error));
    await assert.rejects(wire.request('die', {}), /closed/);
    wire.send({ method: 'initialized' }); await assert.rejects(wire.request('initialize', {}), /unavailable/);
  } finally { wire.close(); await fake.close(); }
});
