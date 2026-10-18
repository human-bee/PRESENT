export function pcmWave(pcm: Buffer, channels: 1 | 2 = 1) {
  if (pcm.length % (2 * channels)) throw new Error('Incomplete PCM frames.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(channels,22);
  header.writeUInt32LE(24000,24); header.writeUInt32LE(48000 * channels,28); header.writeUInt16LE(2 * channels,32); header.writeUInt16LE(16,34);
  header.write('data',36); header.writeUInt32LE(pcm.length,40); return Buffer.concat([header,pcm]);
}
export function assembleInterviewAudio(clips: Array<{ pcm: Buffer; role: 'candidate' | 'recruiter' }>) {
  const gap = 10800; const intro = 24000;
  const total = intro + clips.reduce((sum,clip) => sum + clip.pcm.length / 2 + gap,0);
  if (total > 24000 * 600) throw new Error('Use a short excerpt under ten minutes.');
  const stereo = Buffer.alloc(total * 4); let offset = intro;
  const cues = clips.map((clip) => {
    if (clip.pcm.length % 2) throw new Error('Incomplete PCM frames.');
    const startMs = offset / 24; const channel = clip.role === 'recruiter' ? 0 : 2;
    for (let index = 0; index < clip.pcm.length / 2; index++) stereo.writeInt16LE(clip.pcm.readInt16LE(index * 2),(offset + index) * 4 + channel);
    offset += clip.pcm.length / 2; const endMs = offset / 24; offset += gap;
    return { startMs: Math.round(startMs),endMs: Math.round(endMs) };
  });
  return { wave: pcmWave(stereo,2),durationMs: Math.round(total / 24),cues };
}
