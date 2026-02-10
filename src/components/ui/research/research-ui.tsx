'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle, AlertTriangle, Info } from 'lucide-react';
import type { ResearchResult } from './research-panel';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function toneClasses(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'bg-success-surface text-success border border-success-surface';
    case 'warning':
      return 'bg-warning-surface text-warning border border-warning-surface';
    case 'danger':
      return 'bg-danger-surface text-danger border border-danger-outline';
    case 'neutral':
    default:
      return 'bg-surface-secondary text-secondary border border-default';
  }
}

export function CredibilityBadge({
  level,
  className,
}: { level: 'high' | 'medium' | 'low'; className?: string }) {
  const tone: Tone = level === 'high' ? 'success' : level === 'medium' ? 'warning' : 'danger';
  const Icon = level === 'high' ? CheckCircle : AlertTriangle;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
        toneClasses(tone),
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

export function FactCheckBadge({
  factCheck,
  className,
}: { factCheck: ResearchResult['factCheck']; className?: string }) {
  if (!factCheck) return null;
  const tone: Tone =
    factCheck.status === 'verified'
      ? 'success'
      : factCheck.status === 'disputed'
        ? 'warning'
        : factCheck.status === 'false'
          ? 'danger'
          : 'neutral';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
        toneClasses(tone),
        className,
      )}
    >
      <Info className="h-3 w-3" />
      {factCheck.status} ({factCheck.confidence}%)
    </span>
  );
}

export function SourceTypeChip({ type, className }: { type: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
        toneClasses('neutral'),
        className,
      )}
    >
      <span className="text-tertiary" aria-hidden="true">
        •
      </span>
      {type}
    </span>
  );
}

export function ResultCardShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-default bg-surface-elevated p-4 shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
      data-present-result-card="true"
    >
      {children}
    </section>
  );
}

