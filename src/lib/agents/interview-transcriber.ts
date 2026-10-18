import { voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import type { RemoteParticipant, Room } from '@livekit/rtc-node';
import { randomUUID } from 'node:crypto';

type TranscriptionPayload = {
  type: 'live_transcription'; event_id: string; text: string; speaker: string;
  timestamp: number; is_final: true; server_generated: true;
};
type Options = { room: Room; onTranscript: (payload: TranscriptionPayload) => void };

function interviewParticipants(room: Room) {
  return Array.from(room.remoteParticipants.values()).filter((participant) => {
    try {
      const metadata = JSON.parse(participant.metadata || '{}') as { interviewRole?: string; briefId?: string };
      return ['candidate', 'recruiter'].includes(metadata.interviewRole || '')
        && participant.identity.startsWith(`${metadata.interviewRole}-`)
        && room.name === `open-brief-${metadata.briefId}`;
    } catch { return false; }
  }).sort((a, b) => a.identity.localeCompare(b.identity));
}

export class InterviewTranscriber {
  private sessions = new Map<string, voice.AgentSession>();
  private pending = new Set<Promise<void>>();
  private stopped = false;
  constructor(private options: Options) {}

  private permitted() {
    const participants = interviewParticipants(this.options.room);
    return !this.stopped && participants.some((p) => p.identity.startsWith('candidate-'))
      && participants.some((p) => p.identity.startsWith('recruiter-'))
      && participants.every((p) => p.attributes['open-brief.notes-consent'] === 'true');
  }

  refresh() {
    const chosen = new Map<string, RemoteParticipant>();
    if (this.permitted()) {
      for (const participant of interviewParticipants(this.options.room)) {
        const role = participant.identity.split('-')[0];
        if (!chosen.has(role)) chosen.set(role, participant);
      }
    }
    const desired = new Set(Array.from(chosen.values(), (participant) => participant.identity));
    for (const [identity, session] of this.sessions) {
      if (!desired.has(identity)) { this.sessions.delete(identity); void session.close().catch(() => {}); }
    }
    for (const participant of chosen.values()) if (!this.sessions.has(participant.identity)) this.start(participant);
  }

  private start(participant: RemoteParticipant) {
    const session = new voice.AgentSession({ llm: new realtime.RealtimeModel({
      model: process.env.INTERVIEW_TRANSCRIPTION_REALTIME_MODEL || 'gpt-realtime',
      modalities: ['text'], inputAudioTranscription: { model: 'gpt-4o-mini-transcribe' },
      turnDetection: { type: 'server_vad', create_response: false },
    }) });
    this.sessions.set(participant.identity, session);
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (!event.isFinal || !event.transcript.trim() || !this.permitted() || this.sessions.get(participant.identity) !== session) return;
      this.options.onTranscript({ type: 'live_transcription', event_id: randomUUID(), text: event.transcript.trim(),
        speaker: participant.name || participant.identity, timestamp: Date.now(), is_final: true, server_generated: true });
    });
    session.on(voice.AgentSessionEventTypes.Error, () => console.warn('[interview-listener] A transcription session failed.'));
    const starting = session.start({
      agent: new voice.Agent({ instructions: 'Transcribe only. Never respond, speak, generate a reply, or call tools.' }),
      room: this.options.room,
      inputOptions: { audioEnabled: true, textEnabled: false, participantIdentity: participant.identity },
      outputOptions: { audioEnabled: false, transcriptionEnabled: false },
    }).then(async () => {
      // Permission may have changed while the provider connection was starting.
      if (!this.permitted() || this.sessions.get(participant.identity) !== session) await session.close();
    }).catch(async () => {
      if (this.sessions.get(participant.identity) === session) this.sessions.delete(participant.identity);
      await session.close().catch(() => {});
      console.warn('[interview-listener] Could not start transcription.');
    }).finally(() => { this.pending.delete(starting); });
    this.pending.add(starting);
  }

  async stop() {
    this.stopped = true;
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled([...sessions.map((session) => session.close()), ...this.pending]);
  }
}
