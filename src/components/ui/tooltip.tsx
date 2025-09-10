'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * Represents a tooltip component
 * @property {string} className - Optional className for custom styling
 * @property {number} sideOffset - Offset for the tooltip side
 */

// Provider component that should wrap any tooltips
const TooltipProvider = TooltipPrimitive.Provider;

// Root component for individual tooltips
const TooltipRoot = TooltipPrimitive.Root;

// Trigger component that wraps the element that triggers the tooltip
const TooltipTrigger = TooltipPrimitive.Trigger;

// Content component for tooltip
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-white duration-500 ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-4 data-[side=top]:slide-in-from-bottom-4 data-[side=left]:slide-in-from-left-8 data-[side=right]:slide-in-from-right-8',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Simplified Tooltip component with a unified API
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
  delayDuration = 300,
  open,
  defaultOpen,
  onOpenChange,
  side = 'top',
  align = 'center',
  className,
}: TooltipProps) {
  return (
    <TooltipRoot
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      delayDuration={delayDuration}
    >
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger };
