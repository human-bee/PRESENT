import type { Activity } from '../../shared/activity';
import { activityTemplates } from '../../shared/activity';
import type { Send } from './activity-api';
export function ActivityHeader({
  a,
  active,
  send,
  close,
  onSettings,
}: {
  a: Activity;
  active: boolean;
  send: Send;
  close?: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="activity-header">
      <div>
        <span className="activity-eyebrow">PRESENT / {activityTemplates[a.kind].label.toUpperCase()}</span>
        <div className="activity-title-row">
          <h1>{a.topic}</h1>
          <button type="button" className="activity-icon-button" aria-label="Adapt activity" onClick={onSettings}>
            ↗
          </button>
        </div>
      </div>
      <div className="activity-header-actions">
        <span className="activity-live-dot" />
        {active ? (
          'Live room'
        ) : (
          <button type="button" onClick={() => void send({ type: 'activate' })}>
            Make active
          </button>
        )}
        {close && (
          <button type="button" className="activity-canvas-button" onClick={close}>
            Back to canvas ↙
          </button>
        )}
      </div>
    </header>
  );
}
