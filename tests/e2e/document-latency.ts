import type { Locator } from '@playwright/test';

type Observation = { value: string; at: number; event: string };
type ProbeWindow = Window & { __documentLatency?: { observations: Observation[] } };

/** Observe real widget DOM changes; never set editor state or synthesize an input event. */
export async function armDocumentLatency(input: Locator) {
  await input.evaluate(element => {
    const area = element as HTMLTextAreaElement;
    const view = area.ownerDocument.defaultView as ProbeWindow;
    if (view.__documentLatency) { view.__documentLatency.observations = []; return; }
    const probe = { observations: [] as Observation[] };
    view.__documentLatency = probe;
    const record = (event: Event) => {
      probe.observations.push({ value: area.value, at: performance.timeOrigin + performance.now(), event: event.type });
      if (probe.observations.length > 100) probe.observations.shift();
    };
    // The widget's render listener was installed first, so this observes its updated textarea.
    view.addEventListener('present:state', record);
    area.addEventListener('input', record);
  });
}

export async function documentPropagation(inputs: Locator[], participant: number, expected: string) {
  const observations = await Promise.all(inputs.map(input => input.evaluate(element =>
    (element.ownerDocument.defaultView as ProbeWindow).__documentLatency?.observations ?? [])));
  const local = observations[participant].find(item => item.event === 'input' && item.value === expected);
  if (!local) throw new Error('The actual final input event was not observed.');
  const peers = observations.flatMap((items, i) => {
    if (i === participant) return [];
    const received = items.find(item => item.event === 'present:state' && item.value === expected);
    if (!received) throw new Error(`Participant ${i} did not render the actual final value.`);
    return [{ participant: i, afterLastInputMs: received.at - local.at }];
  });
  return { peers, allPeersAfterLastInputMs: Math.max(...peers.map(peer => peer.afterLastInputMs)) };
}
