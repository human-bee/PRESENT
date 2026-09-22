import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
config({path:'.env.local'});
const { decide } = await import('./decisions');
const { stories } = await import('./stories');
const rows=[];
for(const story of stories) for(const input of story.steps) {
 const result=await decide(input.prompt,'jev');
 rows.push({story:story.name,...input,expectedText:input.text,...result,correct:result.route===input.expected&&(input.seconds===undefined||input.seconds===result.seconds)&&(input.text===undefined||input.text===result.text)});
}
const path=`docs/benchmarks/jev-refinement-${Date.now()}.json`;
await writeFile(path,JSON.stringify(rows,null,2));console.log(JSON.stringify({path,correct:rows.filter(r=>r.correct).length,total:rows.length,failures:rows.filter(r=>!r.correct)}));
