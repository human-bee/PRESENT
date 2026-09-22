import { activityTemplates, makeClaim, type Activity, type Utterance } from '../../shared/activity';
import type { Interpretation } from './interpret-conversation';
import { activityEvent, changeTopic, hashId } from './activity-mutations';

function subjectSide(a: Activity, label: string, requestedId: string | null = null) {
  if (requestedId && !a.sides.some((s) => s.id === requestedId)) return null;
  const named = a.sides.find((s) => s.name.toLocaleLowerCase() === label.toLocaleLowerCase());
  if (named) return named.id;
  const placeholders = activityTemplates[a.kind].lanes;
  const available =
    a.sides.find((s) => placeholders.includes(s.name) && (!requestedId || s.id === requestedId)) ??
    a.sides.find((s) => placeholders.includes(s.name));
  if (available) {
    available.name = label;
    return available.id;
  }
  if (a.sides.length >= 6) return null;
  const side = { id: `side-${hashId([a.id, a.epoch, label])}`, name: label, color: a.sides.length };
  a.sides.push(side);
  return side.id;
}
export function applyInterpretation(a: Activity, u: Utterance, result: Interpretation, elapsedMs: number) {
  u.interpretation = result.plan;
  const plan = result.plan,
    grounded = (quote: string) => quote.trim().length > 0 && u.text.includes(quote);
  if (plan.topic && grounded(plan.topic.quote)) changeTopic(a, plan.topic.title, u.id);
  const span = (quote: string) => ({ utteranceId: u.id, quote, actor: u.speakerId, epoch: a.epoch, at: u.at });
  for (const comparison of plan.comparisons.filter((c) => grounded(c.quote))) {
    if (comparison.subjects.some((s) => s.sideId && !a.sides.some((side) => side.id === s.sideId))) {
      a.observations.push({
        id: `reference-${u.id}`,
        kind: 'uncertainty',
        text: 'That comparison referred to a perspective that is no longer here. Clarify which subjects to compare.',
        sideId: null,
        subject: null,
        source: span(comparison.quote),
      });
      continue;
    }
    const subjects = comparison.subjects.map((s) => ({ ...s, sideId: subjectSide(a, s.label, s.sideId) }));
    const id = `comparison-${hashId([a.id, a.epoch, subjects.map((s) => s.sideId), comparison.dataQuestion])}`;
    if (!a.comparisons.some((c) => c.id === id) && a.comparisons.length < 8) {
      a.comparisons.push({
        id,
        title: comparison.title,
        subjects,
        source: span(comparison.quote),
        dataQuestion: comparison.dataQuestion,
        status: comparison.dataQuestion ? 'pending' : 'visuals',
        error: null,
        chartId: null,
        evidence: null, dataset: null,
      });
    }
    const existing = a.comparisons.find(c => c.id === id);
    if (existing && ['failed', 'uncertain'].includes(existing.status) && comparison.dataQuestion) { existing.status = 'pending'; existing.error = null; }
    for (const subject of subjects) {
      if (
        a.visuals.some(
          (v) => v.epoch === a.epoch && v.sideId === subject.sideId && ['pending', 'done'].includes(v.status),
        )
      )
        continue;
      if (a.visuals.length >= 8) break;
      a.visuals.push({
        id: `visual-${hashId([id, subject.label])}`,
        epoch: a.epoch,
        quote: comparison.quote,
        utteranceId: u.id,
        sideId: subject.sideId,
        query: subject.query,
        status: 'pending',
        error: null,
        images: [],
      });
    }
  }
  for (const [index, item] of plan.contributions.entries()) {
    if (!grounded(item.quote)) continue;
    const sideId = item.subject
      ? (a.sides.find((s) => s.id === item.subject || s.name.toLocaleLowerCase() === item.subject?.toLocaleLowerCase())
          ?.id ?? u.sideId)
      : u.sideId;
    if (item.kind === 'preference' && u.speakerId && sideId) {
      const seat = a.seats.find((s) => s.actor === u.speakerId);
      if (seat) seat.sideId = sideId;
      u.sideId = sideId;
    }
    const id = `idea-${hashId([u.id, index, item.text])}`;
    if (item.kind === 'claim') {
      const corrected = item.replacesClaimId
        ? a.claims.find((c) => c.id === item.replacesClaimId && c.epoch === a.epoch)
        : null;
      if (item.replacesClaimId && !corrected) {
        a.observations.push({
          id: `correction-${u.id}`,
          kind: 'uncertainty',
          text: 'Which claim are you correcting? The earlier reference is no longer available.',
          sideId: null,
          subject: null,
          source: span(item.quote),
        });
        continue;
      }
      if (corrected) {
        corrected.corrections = [
          ...corrected.corrections,
          { actor: u.speakerId ?? 'room:audio', at: u.at, text: corrected.text, reason: item.quote },
        ].slice(-6);
        corrected.text = item.text;
        corrected.version++;
        corrected.quote = item.quote;
        corrected.utteranceId = u.id;
        corrected.review = 'open';
        corrected.research = {
          status: a.autoResearch ? 'pending' : 'idle',
          token: id,
          version: corrected.version,
          error: null,
          elapsedMs: null,
        };
      } else if (!a.claims.some((c) => c.id === id) && a.claims.length < 24) {
        const c = makeClaim(id, {
          text: item.text,
          utteranceId: u.id,
          speakerId: u.speakerId,
          sideId,
          origin: 'model-suggestion',
        });
        c.epoch = a.epoch;
        c.quote = item.quote;
        if (a.autoResearch) c.research = { status: 'pending', token: id, version: 1, error: null, elapsedMs: null };
        a.claims.push(c);
      }
    } else if (!a.observations.some((o) => o.id === id))
      a.observations.push({
        id,
        kind: item.kind,
        text: item.text,
        sideId,
        subject: item.subject,
        source: span(item.quote),
      });
  }
  if (plan.uncertainty)
    a.observations.push({
      id: `uncertain-${u.id}`,
      kind: 'uncertainty',
      text: plan.uncertainty,
      sideId: null,
      subject: null,
      source: span(u.text),
    });
  for (const candidate of plan.resolutions) {
    const blocker = a.meeting.blockers.find((b) => b.id === candidate.blockerId);
    if (!blocker || !grounded(candidate.quote)) continue;
    const id = `resolution-${hashId([u.id, blocker.id])}`;
    if (a.resolutionSuggestions.some((s) => s.id === id)) continue;
    const known = u.source !== 'room-voice' && u.speakerId === blocker.ownerId;
    a.resolutionSuggestions.push({
      id,
      blockerId: blocker.id,
      source: span(candidate.quote),
      intent: candidate.intent,
      status: known && candidate.grounding === 'speaker' && candidate.intent !== 'uncertain' ? 'pending' : 'review',
      reason: known
        ? `Context suggests ${candidate.intent}; awaiting independent interpretation.`
        : 'The blocker owner needs to confirm this interpretation.',
    });
  }
  a.observations = a.observations.slice(-24);
  a.resolutionSuggestions = a.resolutionSuggestions.slice(-12);
  u.extraction = 'done';
  u.model = result.model;
  u.elapsedMs = elapsedMs;
  activityEvent(
    a,
    'agent:context',
    `Followed the conversation with ${result.model}; exact supporting quotes retained.`,
  );
}
