import { AutoSubscribe, cli, defineAgent, type JobContext, WorkerOptions } from '@livekit/agents';
import { RoomEvent } from '@livekit/rtc-node';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { InterviewTranscriber } from './interview-transcriber';

config({ path: '.env.local' });

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const transcriber = new InterviewTranscriber({
      room: ctx.room,
      onTranscript: (payload) => {
        void ctx.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          topic: 'transcription', reliable: payload.is_final,
        }).catch(() => console.warn('[interview-listener] Could not publish transcription.'));
      },
    });
    const refresh = () => transcriber.refresh();
    ctx.room.on(RoomEvent.ParticipantConnected, refresh);
    ctx.room.on(RoomEvent.ParticipantDisconnected, refresh);
    ctx.room.on(RoomEvent.ParticipantAttributesChanged, refresh);
    refresh();
    ctx.addShutdownCallback(async () => {
      ctx.room.off(RoomEvent.ParticipantConnected, refresh);
      ctx.room.off(RoomEvent.ParticipantDisconnected, refresh);
      ctx.room.off(RoomEvent.ParticipantAttributesChanged, refresh);
      await transcriber.stop();
    });
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url), agentName: 'interview-listener' }));
