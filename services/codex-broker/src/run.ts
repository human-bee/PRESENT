import { main } from './server';

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
