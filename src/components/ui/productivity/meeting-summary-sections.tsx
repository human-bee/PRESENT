'use client';

import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ActionItem } from './meeting-summary-schema';

type SummaryTagsProps = {
  tags: string[];
};

export function SummaryTags({ tags }: SummaryTagsProps) {
  if (!tags.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-info-surface px-3 py-1 text-xs font-medium text-info border border-info-surface">
          {tag}
        </span>
      ))}
    </div>
  );
}

type SummaryListProps = {
  title: string;
  items: string[];
};

export function SummaryList({ title, items }: SummaryListProps) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-secondary">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-primary">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-border" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type ActionItemListProps = {
  items: ActionItem[];
};

export function ActionItemList({ items }: ActionItemListProps) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-secondary">Action Items</h3>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div
            key={`${item.task}-${index}`}
            className="rounded-lg border border-default bg-surface-secondary p-3 text-sm text-primary"
          >
            <div className="font-medium">{item.task}</div>
            {(item.owner || item.due) && (
              <div className="mt-1 text-xs text-tertiary">
                {item.owner ? `Owner: ${item.owner}` : ''}
                {item.owner && item.due ? ' · ' : ''}
                {item.due ? `Due: ${item.due}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function EmptySummaryState() {
  return (
    <div className="rounded-lg border border-dashed border-default bg-surface-secondary p-4 text-sm text-secondary">
      No summary yet. Ask the fairies to generate a meeting summary to populate this panel.
    </div>
  );
}

type SendStatusProps = {
  state: 'idle' | 'sending' | 'sent' | 'error';
};

export function SendStatus({ state }: SendStatusProps) {
  if (state === 'sent') {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-success">
        <CheckCircle2 className="h-4 w-4" />
        Sent to CRM
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-danger">
        <AlertTriangle className="h-4 w-4" />
        Unable to send. Check MCP tool configuration.
      </div>
    );
  }
  return null;
}
