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
        <span key={tag} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
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
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-gray-700">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-400" />
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
      <h3 className="text-sm font-semibold text-gray-700">Action Items</h3>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div
            key={`${item.task}-${index}`}
            className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700"
          >
            <div className="font-medium">{item.task}</div>
            {(item.owner || item.due) && (
              <div className="mt-1 text-xs text-gray-500">
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
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
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
      <div className="mt-4 flex items-center gap-2 text-xs text-green-600">
        <CheckCircle2 className="h-4 w-4" />
        Sent to CRM
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-red-600">
        <AlertTriangle className="h-4 w-4" />
        Unable to send. Check MCP tool configuration.
      </div>
    );
  }
  return null;
}
