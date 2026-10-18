import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { replayManifestSchema } from '@present/contracts/interview-replay';
import { InterviewError } from '@present/kernel/interview-store';

export function replayDirectory(id: string) {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new InterviewError(404, 'Replay audio is unavailable.');
  return path.join(process.cwd(), '.present', 'interview-replays', id);
}

export function readReplayManifest(id: string) {
  const file = path.join(replayDirectory(id), 'manifest.json');
  if (!fs.existsSync(file)) throw new InterviewError(404, 'No replay audio is attached to this brief.');
  if (fs.statSync(file).size > 200000) throw new InterviewError(413, 'The replay manifest is too large.');
  return replayManifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function readReplayAudio(id: string) {
  const file = path.join(replayDirectory(id), 'conversation.wav');
  if (!fs.existsSync(file)) throw new InterviewError(404, 'Replay audio is unavailable.');
  if (fs.statSync(file).size > 64 * 1024 * 1024) throw new InterviewError(413, 'The replay audio is too large.');
  return new Uint8Array(fs.readFileSync(file));
}
