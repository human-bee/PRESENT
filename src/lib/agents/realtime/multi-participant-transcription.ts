import { voice } from '@livekit/agents';
import { realtime as openaiRealtime } from '@livekit/agents-plugin-openai';
import { randomUUID } from 'crypto';
import { ParticipantKind, Room, RoomEvent, Track } from 'livekit-client';
import type { RealtimeNoiseReductionOption } from './voice-agent/config';

export type LiveTranscriptionPayload = {
  type: 'live_transcription';
  event_id: string;
  text: string;
  speaker: string;
  participantId: string;
  timestamp: number;
  is_final: boolean;
  manual: false;
  // Extra fields are ignored by existing clients but help us avoid double-processing.
  server_generated?: boolean;
};

export type MultiParticipantTranscriptionOptions = {
  room: Room;
  maxParticipants: number;
  realtimeModel?: string;
  model: string;
  language?: string;
  inputAudioNoiseReduction?: RealtimeNoiseReductionOption | null;
  /**
   * Called for every transcript event (interim + final).
   * The caller is responsible for publishing to the data-channel if desired.
   */
  onTranscript: (payload: LiveTranscriptionPayload) => void;
};

type SessionEntry = {
  participantId: string;
  session: voice.AgentSession;
  stop: () => Promise<void>;
};

const isAgentLike = (participant: any): boolean => {
  try {
    if (participant?.kind === ParticipantKind.AGENT) return true;
    if (participant?.permissions?.agent) return true;
    if (participant?.isAgent) return true;
    const identity = String(participant?.identity || participant?.name || '').toLowerCase();
    if (!identity) return false;
    if (identity.startsWith('agent-')) return true;
    if (identity.includes('voice-agent')) return true;
    return false;
  } catch {
    return false;
  }
};

const getSpeakerLabel = (participant: any): string => {
  const name = typeof participant?.name === 'string' ? participant.name.trim() : '';
  if (name) return name;
  const identity = typeof participant?.identity === 'string' ? participant.identity.trim() : '';
  return identity || 'Speaker';
};

export class MultiParticipantTranscriptionManager {
  private room: Room;
  private maxParticipants: number;
  private realtimeModel?: string;
  private model: string;
  private language?: string;
  private inputAudioNoiseReduction?: RealtimeNoiseReductionOption | null;
  private onTranscript: (payload: LiveTranscriptionPayload) => void;

  private sessions = new Map<string, SessionEntry>();
  private started = false;

  private disposers: Array<() => void> = [];
  private handleRefresh: (() => void) | null = null;
  private handleTrackPublished: ((pub: any, participant: any) => void) | null = null;

  constructor(options: MultiParticipantTranscriptionOptions) {
    this.room = options.room;
    this.maxParticipants = Math.max(1, Math.floor(options.maxParticipants));
    this.realtimeModel = options.realtimeModel;
    this.model = options.model;
    this.language = options.language;
    this.inputAudioNoiseReduction = options.inputAudioNoiseReduction;
    this.onTranscript = options.onTranscript;
  }

  start() {
    if (this.started) return;
    this.started = true;

    this.handleRefresh = () => {
      void this.refreshParticipants();
    };

    this.handleTrackPublished = (pub, participant) => {
      try {
        if (pub?.kind !== Track.Kind.Audio) return;
        if (!participant || isAgentLike(participant)) return;
        // Restart transcription when the audio track changes to avoid stale streams.
        void this.restartParticipant(participant.identity);
      } catch {
        /* noop */
      }
    };

    this.room.on(RoomEvent.ParticipantConnected, this.handleRefresh);
    this.room.on(RoomEvent.ParticipantDisconnected, this.handleRefresh);
    this.room.on(RoomEvent.TrackPublished, this.handleTrackPublished);

    this.disposers.push(() => {
      if (this.handleRefresh) {
        this.room.off(RoomEvent.ParticipantConnected, this.handleRefresh);
      }
    });
    this.disposers.push(() => {
      if (this.handleRefresh) {
        this.room.off(RoomEvent.ParticipantDisconnected, this.handleRefresh);
      }
    });
    this.disposers.push(() => {
      if (this.handleTrackPublished) {
        this.room.off(RoomEvent.TrackPublished, this.handleTrackPublished);
      }
    });

    void this.refreshParticipants();
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch {
        /* noop */
      }
    }
    this.disposers = [];

    const entries = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.allSettled(entries.map((entry) => entry.stop()));
  }

  private listEligibleParticipantIds(): string[] {
    const ids: string[] = [];
    try {
      this.room.remoteParticipants.forEach((participant: any) => {
        if (!participant) return;
        if (isAgentLike(participant)) return;
        const id = String(participant.identity || '').trim();
        if (!id) return;
        ids.push(id);
      });
    } catch {
      /* noop */
    }
    // Stable ordering makes host behavior deterministic when we cap the count.
    ids.sort();
    return ids.slice(0, this.maxParticipants);
  }

  private findRemoteParticipantByIdentity(identity: string): any | null {
    const target = String(identity || '').trim();
    if (!target) return null;
    let found: any | null = null;
    try {
      this.room.remoteParticipants.forEach((participant: any) => {
        if (found) return;
        if (participant?.identity === target) found = participant;
      });
    } catch {
      /* noop */
    }
    return found;
  }

  private async refreshParticipants() {
    const desired = new Set(this.listEligibleParticipantIds());

    // Stop sessions for participants that left (or are now outside the cap).
    for (const [participantId, entry] of this.sessions.entries()) {
      if (desired.has(participantId)) continue;
      this.sessions.delete(participantId);
      void entry.stop().catch(() => {});
    }

    // Start sessions for new participants.
    for (const participantId of desired) {
      if (this.sessions.has(participantId)) continue;
      const participant = this.findRemoteParticipantByIdentity(participantId);
      if (!participant) continue;
      try {
        const entry = await this.startParticipant(participant as any);
        this.sessions.set(participantId, entry);
      } catch (error) {
        console.warn('[MultiParticipantTranscription] failed to start transcriber', {
          participantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async restartParticipant(participantId: string) {
    const existing = this.sessions.get(participantId);
    if (existing) {
      this.sessions.delete(participantId);
      void existing.stop().catch(() => {});
    }
    await this.refreshParticipants();
  }

  private async startParticipant(participant: any): Promise<SessionEntry> {
    const participantId = String(participant?.identity || '').trim();
    if (!participantId) {
      throw new Error('Missing participant identity');
    }
    const speaker = getSpeakerLabel(participant);

    const transcriberAgent = new voice.Agent({
      instructions: [
        'You are a transcription-only helper.',
        'Do not respond, do not call tools. Only produce user input transcriptions.',
      ].join(' '),
    });

    const llm = new openaiRealtime.RealtimeModel({
      ...(this.realtimeModel ? { model: this.realtimeModel } : {}),
      inputAudioTranscription: {
        model: this.model,
        ...(this.language ? { language: this.language } : {}),
      },
      ...(this.inputAudioNoiseReduction !== undefined
        ? { inputAudioNoiseReduction: this.inputAudioNoiseReduction }
        : {}),
      // Important: disable auto-response creation. We only want STT.
      turnDetection: { type: 'server_vad', create_response: false },
    });

    const session = new voice.AgentSession({ llm });

    const onTranscribed = (event: any) => {
      const text = typeof event?.transcript === 'string' ? event.transcript.trim() : '';
      if (!text) return;
      const payload: LiveTranscriptionPayload = {
        type: 'live_transcription',
        event_id: randomUUID(),
        text,
        speaker,
        participantId,
        timestamp: Date.now(),
        is_final: Boolean(event?.isFinal),
        manual: false,
        server_generated: true,
      };
      try {
        this.onTranscript(payload);
      } catch {
        /* noop */
      }
    };

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, onTranscribed);
    session.on(voice.AgentSessionEventTypes.Error, (event: any) => {
      console.warn('[MultiParticipantTranscription] session error', {
        participantId,
        error: event?.error instanceof Error ? event.error.message : String(event?.error || ''),
      });
    });
    session.on(voice.AgentSessionEventTypes.Close, (event: any) => {
      console.log('[MultiParticipantTranscription] session closed', {
        participantId,
        reason: event?.reason,
        code: event?.code,
      });
    });

    await session.start({
      agent: transcriberAgent,
      room: this.room as any,
      inputOptions: {
        audioEnabled: true,
        participantIdentity: participantId,
        audioSampleRate: 24_000,
        audioNumChannels: 1,
      },
      outputOptions: {
        audioEnabled: false,
        transcriptionEnabled: false,
        audioSampleRate: 24_000,
        audioNumChannels: 1,
      },
    });

    const stop = async () => {
      try {
        session.off(voice.AgentSessionEventTypes.UserInputTranscribed, onTranscribed as any);
      } catch {
        /* noop */
      }
      try {
        await session.close();
      } catch {
        /* noop */
      }
    };

    return { participantId, session, stop };
  }
}
