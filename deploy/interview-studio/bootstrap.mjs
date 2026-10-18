import fs from 'node:fs';
import path from 'node:path';
const file = process.env.PRESENT_INTERVIEW_STORE_PATH || path.join(process.cwd(),'.present','interviews.json');
if (!fs.existsSync(file) && process.env.INTERVIEW_BOOTSTRAP_STATE) {
  const content = Buffer.from(process.env.INTERVIEW_BOOTSTRAP_STATE,'base64').toString('utf8');
  const records = JSON.parse(content);
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Invalid bootstrap state.');
  fs.mkdirSync(path.dirname(file),{ recursive: true,mode: 0o700 });
  fs.writeFileSync(file,JSON.stringify(records),{ mode: 0o600,flag: 'wx' });
  console.log('[interview-studio] Initial private test room is ready.');
}
