import type { BenchmarkRun, BenchmarkScenario } from './types';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function scoreBenchmarkRun(
  scenario: BenchmarkScenario,
  run: Pick<
    BenchmarkRun,
    'finalShapeCount' | 'actionSummary' | 'metrics' | 'screenshotPath' | 'status'
  >,
) {
  const notes: string[] = [];
  const minShapes = Math.max(1, scenario.evaluation.minShapeCount);
  const shapeRatio = Math.min(1, run.finalShapeCount / minShapes);
  const shapeScore = Math.round(shapeRatio * 35);
  if (shapeRatio < 1) {
    notes.push(`Shape count below target (${run.finalShapeCount}/${minShapes}).`);
  }

  const requiredVerbs = scenario.evaluation.requiredVerbs ?? [];
  const requiredHits = requiredVerbs.filter(
    (verb) => (run.actionSummary.byName[verb] ?? 0) > 0,
  ).length;
  const requiredScore =
    requiredVerbs.length === 0 ? 35 : Math.round((requiredHits / requiredVerbs.length) * 35);
  if (requiredHits < requiredVerbs.length) {
    notes.push(
      `Missing required verbs: ${requiredVerbs.filter((verb) => (run.actionSummary.byName[verb] ?? 0) === 0).join(', ')}.`,
    );
  }

  const preferredVerbs = scenario.evaluation.preferredVerbs ?? [];
  const preferredHits = preferredVerbs.filter(
    (verb) => (run.actionSummary.byName[verb] ?? 0) > 0,
  ).length;
  const preferredScore =
    preferredVerbs.length === 0 ? 10 : Math.round((preferredHits / preferredVerbs.length) * 10);

  const screenshotScore = run.screenshotPath ? 10 : 0;
  if (!run.screenshotPath) {
    notes.push('Missing final screenshot artifact.');
  }

  const retryPenalty = Math.min(5, run.metrics.totalRetryCount);
  const followupPenalty = Math.min(5, run.metrics.totalFollowupCount);
  const stabilityScore = Math.max(
    0,
    10 - retryPenalty - followupPenalty - (run.status === 'failed' ? 10 : 0),
  );
  if (run.metrics.totalFollowupCount > 0) {
    notes.push(`Followups fired ${run.metrics.totalFollowupCount} time(s).`);
  }
  if (run.metrics.totalRetryCount > 0) {
    notes.push(`Retries recorded ${run.metrics.totalRetryCount} time(s).`);
  }

  const overall = Math.max(
    0,
    Math.min(
      100,
      sum([shapeScore, requiredScore, preferredScore, screenshotScore, stabilityScore]),
    ),
  );
  const grade: BenchmarkRun['score']['grade'] =
    overall >= 85 ? 'excellent' : overall >= 70 ? 'strong' : overall >= 50 ? 'partial' : 'weak';

  return {
    overall,
    grade,
    rubric: {
      shapes: shapeScore,
      requiredVerbs: requiredScore,
      preferredVerbs: preferredScore,
      screenshot: screenshotScore,
      stability: stabilityScore,
    },
    notes,
  } satisfies BenchmarkRun['score'];
}
