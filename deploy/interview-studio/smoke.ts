import fs from 'node:fs';
import path from 'node:path';
import { AudioFrame, AudioSource, LocalAudioTrack, ParticipantKind, Room, RoomEvent, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { createInterview, withInterviewStore } from '@present/kernel/interview-store';
import { readBrief } from '@/lib/interviews/document';
import { createInterviewOpenAI } from '@/lib/agents/interview-openai';
import { synthesizeInterviewSpeech } from '@/lib/agents/interview-speech';
import * as Y from 'yjs';

const directory = path.join(process.cwd(), '.present');
const sessionFile = path.join(directory, 'smoke-v4-session.json');
const reportFile = path.join(directory, 'smoke-v4-result.json');
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const origin = `http://127.0.0.1:${process.env.PORT || '8080'}`;
type Session = { id: string; token: string; candidateToken: string };

async function prepare() {
  if (fs.existsSync(sessionFile)) return;
  if (process.env.INTERVIEW_SMOKE_SESSION) {
    const session = JSON.parse(process.env.INTERVIEW_SMOKE_SESSION) as Session;
    const seed = JSON.parse(Buffer.from(process.env.INTERVIEW_BOOTSTRAP_STATE!, 'base64').toString('utf8'));
    // Reset only the generated QA room before this new test; preserve the separate human-test room.
    if (!seed[session.id]) throw new Error('QA seed is missing');
    await withInterviewStore((records) => { records[session.id] = seed[session.id]; });
    fs.writeFileSync(sessionFile, process.env.INTERVIEW_SMOKE_SESSION, { mode: 0o600 });
    return;
  }
  const { token, interview } = await createInterview({ name: 'Synthetic smoke test', title: 'Engineer', company: 'Private QA', roleContext: 'Fictional infrastructure test only.', research: '', sourceUrl: '' }, false);
  fs.writeFileSync(sessionFile, JSON.stringify({ id: interview.id, token, candidateToken: interview.candidateToken }), { mode: 0o600 });
}

async function run() {
  if (fs.existsSync(reportFile)) { console.log('[interview-smoke] Previous result retained; no paid test repeated.'); return; }
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as Session;
  const checks: Record<string, unknown> = {};
  const rooms: Room[] = []; const sources: AudioSource[] = [];
  let stage = 'web-ready';
  async function api(suffix: string, token = session.token, body?: unknown) {
    const response = await fetch(`${origin}/api/interviews/${session.id}${suffix}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`API status ${response.status}`);
    return response.json();
  }
  const transcripts: Array<{ speaker: string; text: string; receivedAt: number }> = [];
  let pending: Promise<unknown> = Promise.resolve();
  let processingFailed = false;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { if ((await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await pause(1000);
    }
    if (!ready) throw new Error('Web did not start');
    checks.health = true;
    checks.publicPage = (await fetch(`${origin}/interviews`)).status === 200;
    // Probe the public edge separately: a container cannot reliably call its own public ingress.
    checks.unauthorizedDenied = (await fetch(`${origin}/api/interviews/${session.id}`)).status === 404;
    const candidate = await api('', session.candidateToken);
    checks.candidateHasNoRecruiterCapability = !('candidateToken' in candidate.interview);
    checks.credentialsConfigured = candidate.interview.agentAvailable && candidate.interview.callAvailable;
    stage = 'consent';
    await api('', session.token, { action: 'consent', enabled: true });
    await api('', session.candidateToken, { action: 'consent', enabled: true });
    stage = 'livekit-connect';
    for (const token of [session.token, session.candidateToken]) {
      const access = await api('/call', token, {});
      const room = new Room(); rooms.push(room);
      if (token === session.token) room.on(RoomEvent.DataReceived, (payload, sender, _kind, topic) => {
        if (topic !== 'transcription' || sender?.kind !== ParticipantKind.AGENT) return;
        try {
          const data = JSON.parse(new TextDecoder().decode(payload));
          if (data.type !== 'live_transcription' || !data.is_final || !data.text?.trim()) return;
          transcripts.push({ speaker: data.speaker, text: data.text, receivedAt: Date.now() });
          pending = pending.then(async () => {
            await api('', session.token, { action: 'note', transcript: { id: data.event_id, speaker: data.speaker, role: data.role, text: data.text, timestamp: data.timestamp, origin: 'live', example: false } });
            await api('/agent', session.token, { transcriptId: data.event_id, draft: true });
          }).catch(() => { processingFailed = true; });
        } catch { processingFailed = true; }
      });
      await room.connect(access.serverUrl, access.token, { autoSubscribe: true, dynacast: false });
      const source = new AudioSource(24000, 1); sources.push(source);
      await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('synthetic-microphone', source), new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    }
    checks.twoParticipantsConnected = rooms.every((room) => room.isConnected);
    stage = 'listener-dispatch';
    await api('/call', session.token, { listen: true });
    let agent = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      agent = Array.from(rooms[0].remoteParticipants.values()).some((participant) => participant.kind === ParticipantKind.AGENT);
      if (agent) break; await pause(1000);
    }
    checks.listenerJoined = agent;
    if (!agent) throw new Error('Listener did not join');
    stage = 'openai-tts';
    const { client, close } = createInterviewOpenAI(25000);
    let clips: Awaited<ReturnType<typeof synthesizeInterviewSpeech>>[];
    try {
      clips = await Promise.all([
        synthesizeInterviewSpeech(client, 'What did you personally build, and what impact did it have?', 'recruiter'),
        synthesizeInterviewSpeech(client, 'I personally built the deployment dashboard with a team of eight engineers. It reduced deployment time from eighteen minutes to three minutes. We still require a human to approve every release.', 'candidate'),
      ]);
    } finally { await close(); }
    checks.tts = clips.map(({ model, voice, firstByteMs, completeMs }) => ({ model, voice, firstByteMs: Math.round(firstByteMs), completeMs: Math.round(completeMs) }));
    stage = 'realtime-audio';
    await pause(2500);
    const audioEndedAt: number[] = [];
    for (let role = 0; role < clips.length; role++) {
      const pcm = clips[role].pcm;
      for (let offset = 0; offset < pcm.length; offset += 960) {
        const samples = Math.min(480, (pcm.length - offset) / 2);
        const frame = new Int16Array(samples);
        for (let index = 0; index < samples; index++) frame[index] = pcm.readInt16LE(offset + index * 2);
        await sources[role].captureFrame(new AudioFrame(frame, 24000, 1, samples));
      }
      await sources[role].waitForPlayout(); audioEndedAt.push(Date.now());
      for (let silence = 0; silence < 60; silence++) await sources[role].captureFrame(AudioFrame.create(24000, 1, 480));
      await sources[role].waitForPlayout();
      await pause(1500);
    }
    for (let attempt = 0; attempt < 35 && transcripts.length < 2; attempt++) await pause(1000);
    await pending;
    checks.receivedTranscripts = transcripts;
    checks.twoSpeakerAttribution = new Set(transcripts.map((item) => item.speaker)).size === 2;
    checks.originalScriptSentToTranscriber = false;
    checks.audioPlayoutEndedAt = audioEndedAt;
    checks.transcriptRelayAndDraftSucceeded = !processingFailed;
    stage = 'document-verification';
    const final = (await api('')).interview;
    const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(final.encodedState, 'base64'));
    const snapshot = readBrief(doc); doc.destroy();
    checks.work = snapshot.fields.work;
    checks.caveatPreserved = /human|approv/i.test(snapshot.fields.work);
    checks.numbersPreserved = /\b(eight|8)\b/i.test(snapshot.fields.work) && /\b(eighteen|18)\b/i.test(snapshot.fields.work) && /\b(three|3)\b/i.test(snapshot.fields.work);
    checks.noRecruiterQuestionsInWork = !/candidate was asked|what did you|what impact/i.test(snapshot.fields.work);
    checks.acceptedPatches = final.pipeline.flatMap((trace: { patches: unknown[] }) => trace.patches);
    checks.decisionTimings = final.pipeline.map((trace: { state: string; savedAt: number; decisionStartedAt: number }) => ({ state: trace.state, decisionAndSaveMs: trace.savedAt - trace.decisionStartedAt }));
    checks.browserRendering = 'Not measured by this headless media test.';
    if (transcripts.length < 2 || processingFailed || !checks.twoSpeakerAttribution || !checks.caveatPreserved || !checks.numbersPreserved || !checks.noRecruiterQuestionsInWork) throw new Error('Voice-to-document test incomplete');
    checks.passed = true;
  } catch (error) {
    checks.passed = false; checks.failedStage = stage;
    checks.errorType = error instanceof Error ? error.name : 'UnknownError';
  } finally {
    await Promise.allSettled(rooms.map((room) => room.disconnect()));
    await Promise.allSettled(sources.map((source) => source.close()));
    const report = { completedAt: new Date().toISOString(), ...checks };
    fs.writeFileSync(reportFile, JSON.stringify(report), { mode: 0o600 });
    console.log('[interview-smoke] ' + JSON.stringify(report));
  }
}

void (process.argv[2] === 'prepare' ? prepare() : run()).then(() => process.exit(0)).catch(() => { console.error('[interview-smoke] Setup failed.'); process.exit(1); });
