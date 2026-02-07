import React from 'react';

export type MessageDescriptor = {
  id?: string;
  defaultMessage?: string;
};

export function defineMessages<T extends Record<string, MessageDescriptor>>(msgs: T): T {
  Object.keys(msgs).forEach((key) => {
    if (!msgs[key].id) {
      msgs[key].id = key;
    }
  });
  return msgs;
}

export function useMsg(message: MessageDescriptor, values?: Record<string, string | number>): string {
  const base = message.defaultMessage ?? message.id ?? '';
  if (!values) return base;
  return Object.entries(values).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{${key}}`, String(value));
  }, base);
}

export function F({
  defaultMessage,
  values,
}: {
  defaultMessage?: string;
  values?: Record<string, unknown>;
}) {
  if (!defaultMessage) return null;
  if (values && defaultMessage.includes('<')) {
    return (
      <span
        className="i18n-msg"
        // Messages are internal strings; render simple markup when present.
        dangerouslySetInnerHTML={{ __html: defaultMessage }}
      />
    );
  }
  return <span className="i18n-msg">{defaultMessage}</span>;
}
