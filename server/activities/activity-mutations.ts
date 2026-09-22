import { createHash, randomUUID } from 'node:crypto';
import {
  activityTemplates,
  chartSchema,
  makeClaim,
  type Activity,
  type ActivityCommand,
  type Utterance,
} from '../../shared/activity';
import { RoomError } from '../room-store';
export const hashId = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
export const failActivity = (message: string): never => {
  throw new RoomError(message, 409);
};
export function activityEvent(a: Activity, actor: string, text: string, id: string = randomUUID()) {
  a.events.push({ id, actor, text: text.slice(0, 300), at: Date.now() });
}
export function changeTopic(a: Activity, topic: string, utteranceId?: string) {
  if (a.topic === topic) return;
  a.topic = topic;
  a.epoch++;
  const start = utteranceId ? a.utterances.findIndex((u) => u.id === utteranceId) : a.utterances.length;
  for (const [i, u] of a.utterances.entries()) {
    if (i >= start) {
      u.epoch = a.epoch;
      u.sideId = null;
    } else if (['pending', 'running'].includes(u.extraction)) {
      u.extraction = 'off';
      u.error = 'A newer topic superseded this enrichment.';
    }
  }
  a.sides = activityTemplates[a.kind].lanes.map((name, i) => ({ id: `${a.id}-side-${i}`, name, color: i }));
  a.seats.forEach((s) => {
    s.sideId = null;
  });
}
export function appendUtterance(
  a: Activity,
  value: Omit<Utterance, 'interpretation' | 'captureProof' | 'epoch' | 'extraction' | 'error' | 'model' | 'elapsedMs'>,
) {
  if (a.utterances.some((u) => u.id === value.id)) return;
  a.utterances.push({
    ...value,
    captureProof: '',
    interpretation: null,
    epoch: a.epoch,
    extraction: a.ambient ? 'pending' : 'off',
    error: null,
    model: null,
    elapsedMs: null,
  });
}
export function applyActivityCommand(a: Activity, command: ActivityCommand, actor: string, requestId: string) {
  if (command.type === 'comparison-retry') { const c = a.comparisons.find(c => c.id === command.comparisonId && c.source.epoch === a.epoch) ?? failActivity('That comparison belongs to an earlier topic.'); if (['failed', 'uncertain'].includes(c.status)) { c.status = 'pending'; c.error = null; } }
  const seat = a.seats.find((s) => s.actor === actor);
  if ('sideId' in command && command.sideId && command.type !== 'side' && !a.sides.some((s) => s.id === command.sideId))
    failActivity('Choose a side in this activity.');
  if (command.type === 'configure') {
    changeTopic(a, command.topic);
    a.ambient = command.ambient;
    a.autoResearch = command.autoResearch;
  }
  if (command.type === 'seat') {
    if (!seat && a.seats.length >= 24) failActivity('All activity seats are filled.');
    if (seat) Object.assign(seat, { name: command.name, sideId: command.sideId });
    else a.seats.push({ actor, name: command.name, sideId: command.sideId });
  }
  if (command.type === 'side') {
    const side = a.sides.find((s) => s.id === command.sideId);
    if (command.sideId && !side) failActivity('That side no longer exists.');
    if (side) side.name = command.name;
    else {
      if (a.sides.length >= 6) failActivity('This activity supports up to six perspectives.');
      a.sides.push({ id: `side-${hashId([actor, requestId])}`, name: command.name, color: a.sides.length });
    }
  }
  if (command.type === 'say')
    appendUtterance(a, {
      id: `speech-${hashId([actor, requestId])}`,
      text: command.text,
      at: Date.now(),
      source: 'typed',
      speakerId: actor,
      speakerName: seat?.name ?? 'Participant',
      sideId: seat?.sideId ?? null,
    });
  if (command.type === 'attribute') {
    const u =
      a.utterances.find((u) => u.id === command.utteranceId) ??
      failActivity('That conversation entry is no longer retained.');
    const speaker = a.seats.find((s) => s.actor === command.speakerId);
    if (command.speakerId && !speaker) failActivity('Choose a seated participant.');
    u.speakerId = command.speakerId;
    u.speakerName = speaker?.name ?? 'Shared microphone';
    u.sideId = command.sideId;
    for (const c of a.claims.filter((c) => c.utteranceId === u.id)) {
      c.speakerId = u.speakerId;
      c.sideId = u.sideId;
    }
    // Human attribution is visible context; it does not turn a shared microphone into authenticated personal capture.
  }
  if (command.type === 'extract') {
    const u =
      a.utterances.find((u) => u.id === command.utteranceId) ??
      failActivity('That conversation entry is no longer retained.');
    if (u.epoch !== a.epoch) failActivity('This belongs to an earlier topic. Continue it in a new contribution.');
    if (!['pending', 'running'].includes(u.extraction)) {
      u.extraction = 'pending';
      u.error = null;
    }
  }
  if (command.type === 'claim') {
    if (a.claims.length >= 24) failActivity('The claim board is full.');
    const u = command.utteranceId ? a.utterances.find((u) => u.id === command.utteranceId) : null;
    if (command.utteranceId && !u) failActivity('That conversation entry is no longer retained.');
    a.claims.push({
      ...makeClaim(`claim-${hashId([actor, requestId])}`, {
        text: command.text,
        utteranceId: u?.id ?? null,
        sideId: command.sideId,
        speakerId: u ? u.speakerId : actor,
        origin: 'participant',
      }),
      epoch: a.epoch,
      quote: u?.text ?? command.text,
    });
  }
  if ('claimId' in command) {
    const c = a.claims.find((c) => c.id === command.claimId) ?? failActivity('That claim no longer exists.');
    if (command.type === 'correct') {
      c.corrections = [...c.corrections, { actor, at: Date.now(), text: c.text, reason: command.reason }].slice(-6);
      c.text = command.text;
      c.sideId = command.sideId;
      c.version++;
      c.review = 'open';
      c.research = { status: 'idle', token: '', version: c.version, error: null, elapsedMs: null };
    }
    if (command.type === 'review') {
      c.review = command.review;
      c.corrections = [...c.corrections, { actor, at: Date.now(), text: c.text, reason: command.reason }].slice(-6);
    }
    if (command.type === 'research' && !['running', 'pending'].includes(c.research.status))
      c.research = {
        status: 'pending',
        token: hashId([actor, requestId]),
        version: c.version,
        error: null,
        elapsedMs: null,
      };
  }
  if (command.type === 'visual') {
    if (a.visuals.length >= 8) failActivity('This activity has reached its visual limit.');
    a.visuals.push({
      id: `visual-${hashId([actor, requestId])}`,
      epoch: a.epoch,
      quote: '',
      utteranceId: null,
      sideId: command.sideId,
      query: command.query,
      status: 'pending',
      error: null,
      images: [],
    });
  }
  if (command.type === 'chart') {
    if (a.charts.length >= 6) failActivity('This activity has reached its chart limit.');
    a.charts.push(
      chartSchema.parse({
        ...command.chart,
        epoch: a.epoch,
        id: `chart-${hashId([actor, requestId])}`,
        suppliedBy: actor,
      }),
    );
  }
  activityEvent(
    a,
    actor,
    command.type === 'correct' || command.type === 'review'
      ? `${command.type}: ${command.reason}`
      : `Room action: ${command.type}`,
    requestId,
  );
}
