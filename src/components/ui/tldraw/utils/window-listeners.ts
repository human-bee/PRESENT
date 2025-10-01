export type Listener = [string, EventListener];

export function withWindowListeners(
  configure: (add: (event: string, handler: EventListener) => void) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const listeners: Listener[] = [];
  const add = (event: string, handler: EventListener) => {
    window.addEventListener(event, handler);
    listeners.push([event, handler]);
  };

  configure(add);

  return () => {
    for (const [event, handler] of listeners) {
      window.removeEventListener(event, handler);
    }
  };
}
