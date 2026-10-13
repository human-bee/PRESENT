// Test-only preload: kill the isolated server after canonical flush and before
// the atomic private completed receipt rename. No production hook or route.
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const root = process.env.PRESENT_DATA_DIRECTORY;
if (!root || !fs.existsSync(join(root, 'controlled-codex', 'CONTROLLED_TEST_ONLY')))
  throw new Error('Completion crash preload requires the disposable controlled fixture.');
const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (typeof to === 'string' && dirname(to) === join(root, 'work-jobs') && to.endsWith('.json')) {
    const job = JSON.parse(fs.readFileSync(from, 'utf8'));
    if (job.status === 'completed') {
      fs.writeFileSync(join(root, 'completion-crash.json'), JSON.stringify({ jobId: job.jobId, pid: process.pid }));
      process.kill(process.pid, 'SIGKILL');
      throw new Error('SIGKILL did not stop the controlled fixture.');
    }
  }
  return rename(from, to);
};
syncBuiltinESMExports();
