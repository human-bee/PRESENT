'use client';

import type { ReactNode } from 'react';

type CodexRemoteFrameProps = {
  title: string;
  frameUrl: string;
  subtitle?: string | null;
  toolbar?: ReactNode;
};

export function CodexRemoteFrame({ title, frameUrl, subtitle, toolbar }: CodexRemoteFrameProps) {
  return (
    <div className="reset-frame-shell">
      <div className="reset-list-card">
        <div className="reset-list-card__eyebrow">{title}</div>
        <strong>{subtitle || 'Live remote Codex surface'}</strong>
        {toolbar}
      </div>
      <iframe
        title={title}
        className="reset-frame"
        src={frameUrl}
        allow="clipboard-read; clipboard-write"
        loading="lazy"
      />
    </div>
  );
}
