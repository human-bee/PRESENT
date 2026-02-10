'use client';

import * as React from 'react';
import { Tooltip as OaiTooltip } from '@openai/apps-sdk-ui/components/Tooltip';

// Provider is a no-op for Apps SDK UI tooltips (it composes Radix internally),
// but we keep it for back-compat with existing callsites.
function TooltipProvider({ children }: { children: React.ReactNode; delayDuration?: number }) {
  return <>{children}</>;
}

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delayDuration?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

function Tooltip({
  content,
  children,
  delayDuration = 150,
  open,
  // retained for API compatibility; Apps SDK UI manages state internally
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  defaultOpen,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onOpenChange,
  side = 'top',
  align = 'center',
  className,
}: TooltipProps) {
  return (
    <OaiTooltip
      content={content}
      openDelay={delayDuration}
      forceOpen={typeof open === 'boolean' ? open : undefined}
      side={side}
      align={align}
      contentClassName={className}
    >
      {children}
    </OaiTooltip>
  );
}

const TooltipRoot = OaiTooltip.Root;
const TooltipTrigger = OaiTooltip.Trigger;
const TooltipContent = OaiTooltip.Content;

export { Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger };

