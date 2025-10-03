declare global {
  interface Window {
    __PRESENT_LISTENERS__?: Record<string, EventListener>;
  }
}

export type WindowListenerCleanup = () => void;

export function registerWindowListener(eventName: string, handler: EventListener): WindowListenerCleanup {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener(eventName, handler);
  return () => {
    window.removeEventListener(eventName, handler);
  };
}

export function registerSingletonWindowListener(
  flag: string,
  eventName: string,
  handler: EventListener,
): WindowListenerCleanup {
  if (typeof window === 'undefined') {
    return () => {};
  }

  if (!window.__PRESENT_LISTENERS__) {
    window.__PRESENT_LISTENERS__ = {};
  }

  const listeners = window.__PRESENT_LISTENERS__;
  const existing = listeners[flag];

  if (existing) {
    window.removeEventListener(eventName, existing);
  }

  window.addEventListener(eventName, handler);
  listeners[flag] = handler;

  return () => {
    if (listeners[flag] === handler) {
      window.removeEventListener(eventName, handler);
      delete listeners[flag];
    }
  };
}
