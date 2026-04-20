'use client';

import { useMemo, useRef, useState } from 'react';
import { CodexRemoteFrame } from '@present/ui/codex-remote-frame';
import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { codexRemoteWidgetSchema, type CodexRemoteWidgetProps } from './codex-remote-widget-schema';

export { codexRemoteWidgetSchema };

type CodexRemoteWidgetState = {
  title?: string;
  subtitle?: string;
  frameUrl?: string;
  className?: string;
  contextKey?: string;
};

function createFallbackId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `codex-remote-${crypto.randomUUID()}`;
  }
  return `codex-remote-${Date.now().toString(36)}`;
}

export function CodexRemoteWidget(props: CodexRemoteWidgetProps) {
  const { __custom_message_id, messageId: propMessageId, contextKey, className, ...rest } = props;
  const fallbackIdRef = useRef<string | null>(null);
  if (!fallbackIdRef.current) {
    fallbackIdRef.current = createFallbackId();
  }
  const messageId = (__custom_message_id || propMessageId || fallbackIdRef.current)!;

  const [state, setState] = useState<CodexRemoteWidgetState>(() => ({
    title: rest.title,
    subtitle: rest.subtitle,
    frameUrl: rest.frameUrl,
    className,
    contextKey,
  }));

  const registryProps = useMemo(
    () => ({
      title: state.title,
      subtitle: state.subtitle,
      frameUrl: state.frameUrl,
      className,
      contextKey,
    }),
    [className, contextKey, state.frameUrl, state.subtitle, state.title],
  );

  useComponentRegistration(messageId, 'CodexRemoteWidget', registryProps, contextKey || 'canvas', (patch) => {
    setState((previous) => ({
      ...previous,
      title: typeof patch.title === 'string' ? patch.title : previous.title,
      subtitle: typeof patch.subtitle === 'string' ? patch.subtitle : previous.subtitle,
      frameUrl: typeof patch.frameUrl === 'string' ? patch.frameUrl : previous.frameUrl,
      className: typeof patch.className === 'string' ? patch.className : previous.className,
    }));
  });

  return (
    <div className={cn('w-full h-full', state.className)}>
      {state.frameUrl ? (
        <CodexRemoteFrame
          title={state.title || 'Remote Codex'}
          subtitle={state.subtitle || 'Brokered remote Codex surface'}
          frameUrl={state.frameUrl}
        />
      ) : (
        <div className="reset-empty">No remote Codex frame URL configured.</div>
      )}
    </div>
  );
}

export default CodexRemoteWidget;
