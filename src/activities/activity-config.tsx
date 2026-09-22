import type { Activity } from '../../shared/activity';
import { activityTemplates } from '../../shared/activity';
import type { Send } from './activity-api';
export function ActivitySettings({ a, send, onClose }: { a: Activity; send: Send; onClose: () => void }) {
  return (
    <form
      className="activity-config"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        void send({
          type: 'configure',
          topic: String(d.get('topic')),
          ambient: d.has('ambient'),
          autoResearch: d.has('research'),
        }).then((ok) => {
          if (ok) onClose();
        });
      }}
    >
      <label>
        Room topic
        <input name="topic" defaultValue={a.topic} maxLength={180} required />
      </label>
      <label>
        <input name="ambient" type="checkbox" defaultChecked={a.ambient} /> Follow the conversation
      </label>
      <label>
        <input name="research" type="checkbox" defaultChecked={a.autoResearch} /> Bring in sources automatically
      </label>
      <button type="submit">Save adaptation</button>
    </form>
  );
}
