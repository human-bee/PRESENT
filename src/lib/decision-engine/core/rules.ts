import type {
  DecisionEngineConfig,
  IntentResult,
  NormalizedTranscript,
  RuleEvaluation,
} from './types';

const DEFAULT_YOUTUBE_KEYWORDS = [
  'youtube',
  'video',
  'music video',
  'song',
  'artist',
  'channel',
  'search for',
  'find',
  'show me',
  'play',
  'watch',
  'latest',
  'newest',
];

const DEFAULT_COMPONENT_KEYWORDS = [
  'component',
  'timer',
  'chart',
  'button',
  'form',
  'create',
  'build',
  'add',
  'dashboard',
  'widget',
  'card',
  'list',
  'table',
];

const ACTIONABLE_KEYWORDS = ['create', 'add', 'build', 'show', 'update', 'search', 'find'];

export function detectIntent(
  normalized: NormalizedTranscript,
  config: DecisionEngineConfig,
): IntentResult {
  const youtubeKeywords = config.keywords?.youtube_search ?? DEFAULT_YOUTUBE_KEYWORDS;
  const hasYoutubeIntent =
    youtubeKeywords.some((keyword) => normalized.lower.includes(keyword)) ||
    /\b(show|find|search|play)\b.*\b(video|song|music|artist)\b/.test(normalized.lower);

  if (hasYoutubeIntent) {
    const wantsLatest = /\b(latest|newest|recent|new|today|this week)\b/.test(normalized.lower);
    const wantsOfficial = /\b(official|vevo|verified)\b/.test(normalized.lower);

    let rawQuery = normalized.trimmed;
    const searchMatch = normalized.raw.match(/(?:search for|find|show me|play)\s+"?([^"]+)"?/i);
    if (searchMatch) {
      rawQuery = searchMatch[1];
    }

    let artist = '';
    if (normalized.lower.includes('pinkpantheress') || normalized.lower.includes('pink pantheress')) {
      artist = 'PinkPantheress';
    }

    let contentType: string | undefined;
    if (normalized.lower.includes('music video') || normalized.lower.includes('song')) {
      contentType = 'music';
    } else if (normalized.lower.includes('tutorial')) {
      contentType = 'tutorial';
    }

    return {
      intent: 'youtube_search',
      structuredContext: {
        rawQuery,
        wantsLatest,
        wantsOfficial,
        contentType,
        artist,
      },
    };
  }

  const componentKeywords = config.keywords?.create_component ?? DEFAULT_COMPONENT_KEYWORDS;
  const hasComponentIntent = componentKeywords.some((keyword) => normalized.lower.includes(keyword));

  if (hasComponentIntent) {
    return { intent: 'ui_component' };
  }

  return { intent: 'general' };
}

export function evaluateRules(normalized: NormalizedTranscript): RuleEvaluation {
  const isSingleWord = normalized.wordCount <= 2;
  const hasDecisionKeyword = ACTIONABLE_KEYWORDS.some((keyword) => normalized.lower.includes(keyword));
  return { isSingleWord, hasDecisionKeyword };
}
