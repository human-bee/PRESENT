import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, questionsFor } from '../server/agents/semantic-decisions';

test('bounded decisions reject malformed distributions and uncertain arguments', async () => {
 const originalFetch=globalThis.fetch, originalKey=process.env.TYPESAFE_API_KEY;
 process.env.TYPESAFE_API_KEY='synthetic-test-key';
 const request='Start a 2 minute timer.';
 const {questions}=questionsFor(request);
 const answers=Object.fromEntries(Object.entries(questions).map(([key,q])=>{
  const selected=key==='route'?'timer':key==='duration'?'d0':'none';
  return [key,{choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===selected?1:0]))}];
 }));
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({answers}));
  assert.equal((await decide(request,'jev')).seconds,120);
  answers.duration.confidence=.7;
  assert.equal((await decide(request,'jev')).route,'defer');
  answers.duration.confidence=1;
  answers.route.probabilities.timer=.6;
  assert.equal((await decide(request,'jev')).route,'defer');
  answers.route.choice='delete_everything';
  assert.equal((await decide(request,'jev')).route,'defer');
 } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=originalKey;}
});
