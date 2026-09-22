import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
import { MemberIntroductions } from './member-introduction';
import { BlockerBoard } from './blocker-board';
import { CommitmentBoard } from './commitment-board';
export function MeetingFloor({
  activity,
  selfId,
  name,
  send,
  roomId,
}: {
  activity: Activity;
  selfId: string;
  name: string;
  send: Send;
  roomId: string;
}) {
  return (
    <section className="meeting-floor">
      {!activity.seats.some((s) => s.actor === selfId) && (
        <button type="button" onClick={() => void send({ type: 'seat', name, sideId: null })}>
          Join the standup
        </button>
      )}
      <MemberIntroductions activity={activity} selfId={selfId} send={send} />
      <div className="meeting-work-grid">
        <BlockerBoard activity={activity} selfId={selfId} send={send} />
        <CommitmentBoard activity={activity} selfId={selfId} send={send} roomId={roomId} />
      </div>
    </section>
  );
}
