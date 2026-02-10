/**
 * WidgetFrame
 *
 * Consistent "chrome" for canvas widgets: surface, border, header typography,
 * and action slot. Keeps widget-specific content styling inside `children`.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export function WidgetFrame({
  title,
  subtitle,
  meta,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        'w-full rounded-2xl border border-default bg-surface-elevated shadow-sm overflow-hidden',
        className,
      )}
      data-present-widget-frame="true"
    >
      <header className="flex items-start justify-between gap-4 border-b border-default px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="heading-sm truncate">{title}</div>
          </div>
          {(subtitle || meta) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {subtitle ? <span className="text-secondary">{subtitle}</span> : null}
              {meta ? <span className="text-tertiary">{meta}</span> : null}
            </div>
          )}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

