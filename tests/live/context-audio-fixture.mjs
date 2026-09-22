import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export function makeSpeech(directory, name, text) {
  const aiff = `${directory}/${name}.aiff`, wav = `${directory}/${name}.wav`;
  execFileSync('/usr/bin/say', ['-r', '165', '-o', aiff, text]);
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-af', 'adelay=200:all=1,apad=pad_dur=0.5', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  return readFileSync(wav).toString('base64');
}
export function installSyntheticMicrophone() {
  const now = () => performance.timeOrigin + performance.now();
  window.__contextPeers = []; const OriginalPeer = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(OriginalPeer, { construct(target, args) { const peer = new target(...args); window.__contextPeers.push(peer); return peer; } });
  const fixture = { context: null, destination: null, tracks: [], lastAudible: null, firstAudible: null };
  window.__contextAudio = fixture;
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (constraints.video) throw new Error('Physical camera capture is disabled in this synthetic-input proof.');
    if (!fixture.context) {
      const context = new AudioContext({ sampleRate: 48000 }), destination = context.createMediaStreamDestination();
      fixture.context = context; fixture.destination = destination;
      const code = `class Probe extends AudioWorkletProcessor { process(inputs,outputs) { const d=inputs[0]?.[0]; if(d){for(const channel of outputs[0]??[])channel.set(d);let first=-1,last=-1,sum=0;for(let i=0;i<d.length;i++){sum+=d[i]**2;if(Math.abs(d[i])>.001){if(first<0)first=i;last=i;}}if(last>=0&&Math.sqrt(sum/d.length)>.001)this.port.postMessage({first:currentFrame+first,last:currentFrame+last,sampleRate});}return true;} } registerProcessor('context-probe',Probe);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      const probe = new AudioWorkletNode(context, 'context-probe'); fixture.probe = probe; probe.connect(destination);
      probe.port.onmessage = ({ data }) => { const stamp=now(), current=context.currentTime; fixture.firstAudible ??= stamp-(current-data.first/data.sampleRate)*1000; fixture.lastAudible=stamp-(current-data.last/data.sampleRate)*1000; };
    }
    await fixture.context.resume(); const stream = fixture.destination.stream.clone(); fixture.tracks.push(...stream.getTracks()); return stream;
  };
  navigator.mediaDevices.getDisplayMedia = async () => { throw new Error('Physical screen capture is disabled.'); };
  fixture.play = async base64 => {
    fixture.firstAudible = null; fixture.lastAudible = null;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)), source = fixture.context.createBufferSource();
    source.buffer = await fixture.context.decodeAudioData(bytes.buffer); source.connect(fixture.probe);
    await new Promise(resolve => { source.onended = resolve; source.start(); }); source.disconnect();
    return { firstAudible: fixture.firstAudible, lastAudible: fixture.lastAudible };
  };
}
