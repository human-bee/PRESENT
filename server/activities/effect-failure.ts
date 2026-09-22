import type { Activity, Claim } from '../../shared/activity';
export function effectFailure(next: Activity, effect: { id: string }, message: string, c?: Claim) {
  const utterance = next.utterances.find((x) => x.id === effect.id),
    claim = next.claims.find((x) => x.id === effect.id),
    visual = next.visuals.find((x) => x.id === effect.id),
    data = next.comparisons.find((x) => x.id === effect.id),
    resolution = next.resolutionSuggestions.find((x) => x.id === effect.id);
  if (utterance) {
    utterance.extraction = 'failed';
    utterance.error = message;
  }
  if (claim && claim.version === c?.version && claim.research.token === c.research.token) {
    claim.research.status = 'failed';
    claim.research.error = message;
  }
  if (visual) {
    visual.status = 'failed';
    visual.error = message;
  }
  if (data) {
    data.status = 'failed';
    data.error = message;
  }
  if (resolution) {
    resolution.status = 'review';
    resolution.reason = message;
  }
}
