import * as React from 'react';

// Minimal Jest-compatible stubs for `@openai/apps-sdk-ui/components/*`.
// The real package ships ESM-only JS; Jest in this repo runs in CJS mode.

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: string;
  variant?: string;
  size?: string;
  uniform?: boolean;
  pill?: boolean;
  loading?: boolean;
  selected?: boolean;
  block?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ loading, children, ...props }, ref) => (
    <button ref={ref} {...props}>
      {loading ? 'Loading…' : children}
    </button>
  ),
);
Button.displayName = 'Button';

export const ButtonLink = (props: any) => React.createElement('a', props);
export const CopyButton = (props: any) => React.createElement('button', props);

export const AppsSDKUIProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

export type TooltipProps = {
  children: React.ReactNode;
  content: React.ReactNode;
  forceOpen?: boolean;
  openDelay?: number;
  side?: string;
  align?: string;
  contentClassName?: string;
};

function TooltipImpl({ children }: TooltipProps) {
  return <>{children}</>;
}

export const Tooltip: any = Object.assign(TooltipImpl, {
  Root: ({ children }: any) => <>{children}</>,
  Content: ({ children }: any) => <>{children}</>,
  Trigger: ({ children }: any) => <>{children}</>,
  TriggerDecorator: ({ children }: any) => <>{children}</>,
});

