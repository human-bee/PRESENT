/**
 * Present Button (adapter)
 *
 * Keep existing import paths stable while migrating to OpenAI Apps SDK UI.
 */

'use client';

import * as React from 'react';
import { Button as OaiButton, type ButtonProps as OaiButtonProps } from '@openai/apps-sdk-ui/components/Button';
import { cn } from '@/lib/utils';

export type PresentButtonVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link';

export type PresentButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps
  extends Omit<OaiButtonProps, 'variant' | 'color' | 'size' | 'uniform' | 'pill'> {
  variant?: PresentButtonVariant;
  size?: PresentButtonSize;
}

function mapVariant(variant: PresentButtonVariant | undefined): {
  color: OaiButtonProps['color'];
  variant: NonNullable<OaiButtonProps['variant']>;
  className?: string;
} {
  switch (variant) {
    case 'destructive':
      return { color: 'danger', variant: 'solid' };
    case 'outline':
      return { color: 'primary', variant: 'outline' };
    case 'secondary':
      return { color: 'secondary', variant: 'solid' };
    case 'ghost':
      return { color: 'secondary', variant: 'ghost' };
    case 'link':
      return { color: 'primary', variant: 'ghost', className: 'underline underline-offset-4' };
    case 'default':
    default:
      // Intentionally neutral: Apps SDK UI "primary" is gray by default.
      return { color: 'primary', variant: 'solid' };
  }
}

function mapSize(size: PresentButtonSize | undefined): {
  size: NonNullable<OaiButtonProps['size']>;
  uniform?: boolean;
} {
  switch (size) {
    case 'sm':
      return { size: 'sm' };
    case 'lg':
      return { size: 'lg' };
    case 'icon':
      return { size: 'md', uniform: true };
    case 'default':
    default:
      return { size: 'md' };
  }
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'default', className, ...props }, ref) => {
    const mappedVariant = mapVariant(variant);
    const mappedSize = mapSize(size);
    return (
      <OaiButton
        {...props}
        ref={ref}
        color={mappedVariant.color}
        variant={mappedVariant.variant}
        size={mappedSize.size}
        uniform={mappedSize.uniform}
        pill={false}
        className={cn(mappedVariant.className, className)}
      />
    );
  },
);
Button.displayName = 'Button';

/**
 * Back-compat export.
 * `buttonVariants` used to be `cva(...)`. It is no longer needed after migrating to Apps SDK UI.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const buttonVariants = (_opts?: { variant?: PresentButtonVariant; size?: PresentButtonSize; className?: string }) =>
  '';

export { Button };

