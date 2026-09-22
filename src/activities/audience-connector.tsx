import { useState } from 'react';
import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
export function AudienceConnector({ a, host, send }: { a: Activity; host: boolean; send: Send }) {
  const [connect, setConnect] = useState(false);
  const connection = a.audience.connection;
  return (
    <aside className="audience-connector">
      <div>
        <strong>YouTube live chat · {connection?.status ?? 'not connected'}</strong>
        <p>
          {connection?.error ??
            (connection?.lastAt
              ? `Last read ${new Date(connection.lastAt).toLocaleTimeString()}. Incoming comments require host approval.`
              : 'Connect an active live chat, or use the room audience link above.')}
        </p>
      </div>
      {host && (
        <>
          <button type="button" onClick={() => setConnect(!connect)}>
            Connect YouTube chat
          </button>
          {connection && (
            <button type="button" onClick={() => void send({ type: 'audience-stop' })}>
              Stop chat feed
            </button>
          )}
        </>
      )}
      {connect && host && (
        <form
          className="activity-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void send({
              type: 'audience-connect',
              liveChatId: String(data.get('chat')),
              videoId: String(data.get('video')),
            });
          }}
        >
          <label>
            YouTube video ID
            <input name="video" required pattern="[a-zA-Z0-9_-]{11}" maxLength={11} />
          </label>
          <label>
            Active live chat ID
            <input name="chat" required pattern="[a-zA-Z0-9_-]{10,500}" maxLength={500} />
          </label>
          <button type="submit">Read live comments</button>
          <small>
            Requires YOUTUBE_API_KEY in the server environment. YouTube supplies the activeLiveChatId in
            liveStreamingDetails for an active broadcast. This connector reads comments; moderation here changes only
            this room.
          </small>
        </form>
      )}
    </aside>
  );
}
