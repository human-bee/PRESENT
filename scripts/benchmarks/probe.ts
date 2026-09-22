import { config } from 'dotenv';
config({path:'.env.local'});
const { decide } = await import('./decisions');
for (const engine of ['jev','cerebras','luna'] as const) {
 try { console.log(JSON.stringify({engine,...await decide('Start a 2 minute timer for our design critique.',engine)})); }
 catch(error) { console.log(JSON.stringify({engine,error:error instanceof Error ? error.message : 'unknown'})); }
}
process.exit(0);
