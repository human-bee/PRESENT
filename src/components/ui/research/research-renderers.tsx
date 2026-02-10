import React from 'react';
import dynamic from 'next/dynamic';
import { ResearchResult } from './research-panel';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  MessageCircle,
  FileText,
  Layout,
} from 'lucide-react';
import { useToolDispatcher } from '@/components/tool-dispatcher';
import { Button } from '@/components/ui/shared/button';
import {
  CredibilityBadge,
  FactCheckBadge,
  ResultCardShell,
  SourceTypeChip,
} from './research-ui';

// Dynamic import for YouTube embed - only load when needed
const YoutubeEmbed = dynamic(
  () => import('../youtube/youtube-embed').then((mod) => ({ default: mod.YoutubeEmbed })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center rounded-lg border border-default bg-surface-secondary p-4 text-sm text-secondary">
        Loading video...
      </div>
    ),
  },
);

/* -------------------------------------------------------------------------- */
/*                                Base types                                  */
/* -------------------------------------------------------------------------- */

type BaseRendererProps = {
  result: ResearchResult;
  isBookmarked: boolean;
  isExpanded: boolean;
  onToggleBookmark: () => void;
  onToggleExpanded: () => void;
};

/* -------------------------------------------------------------------------- */
/*                              Quick Actions Bar                             */
/* -------------------------------------------------------------------------- */

function QuickActions({ result }: { result: ResearchResult }) {
  const { executeToolCall } = useToolDispatcher();

  const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const fire = (tool: string, params: Record<string, unknown>) => {
    void executeToolCall({
      id: generateId(),
      roomId: 'local', // will be overridden inside dispatcher with room context if needed
      type: 'tool_call',
      payload: { tool, params },
      timestamp: Date.now(),
      source: 'system',
    } as any);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="text-[var(--present-accent)] hover:bg-surface-secondary"
        onClick={() =>
          fire('create_component', {
            type: 'message_thread',
            prompt: `Discuss research finding: ${result.title}`,
          })
        }
      >
        <MessageCircle className="h-4 w-4" /> Discuss
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-[var(--present-accent)] hover:bg-surface-secondary"
        onClick={() =>
          fire('create_component', {
            type: 'summary',
            prompt: `Summarize research finding: ${result.title}`,
          })
        }
      >
        <FileText className="h-4 w-4" /> Summarize
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-[var(--present-accent)] hover:bg-surface-secondary"
        onClick={() =>
          fire('create_component', {
            type: 'presentation_deck',
            prompt: `Add slide for research finding: ${result.title}`,
          })
        }
      >
        <Layout className="h-4 w-4" /> Add to Deck
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Text Renderer                                */
/* -------------------------------------------------------------------------- */

function TextResearchRenderer({
  result,
  isBookmarked,
  isExpanded,
  onToggleBookmark,
  onToggleExpanded,
}: BaseRendererProps) {
  return (
    <ResultCardShell>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold leading-5 text-primary line-clamp-2">
            {result.title}
          </h3>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-secondary">{result.source.name}</span>
            <CredibilityBadge level={result.source.credibility} />
            <SourceTypeChip type={result.source.type} />
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggleBookmark}
            className="rounded p-1 text-secondary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          >
            {isBookmarked ? (
              <BookmarkCheck className="h-4 w-4 text-[var(--present-accent)]" />
            ) : (
              <Bookmark className="h-4 w-4 text-tertiary" />
            )}
          </button>
          {result.source.url && (
            <a
              href={result.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-secondary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              title="Open source"
            >
              <ExternalLink className="h-4 w-4 text-tertiary" />
            </a>
          )}
        </div>
      </div>
      {/* Content */}
      <div className="mb-3">
        <p className={cn('text-sm leading-relaxed text-secondary', !isExpanded && 'line-clamp-3')}>
          {result.content}
        </p>
        {result.content.length > 200 && (
          <button
            onClick={onToggleExpanded}
            className="mt-1 text-xs font-medium text-[var(--present-accent)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)] rounded"
          >
            {isExpanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-tertiary">Relevance: {result.relevance}%</span>
          {result.factCheck && <FactCheckBadge factCheck={result.factCheck} />}
        </div>
        <span className="text-xs text-tertiary">
          {new Date(result.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <QuickActions result={result} />
      {/* Tags */}
      {result.tags && result.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {result.tags.map((tag, idx) => (
            <span
              key={idx}
              className="inline-block rounded-full border border-default bg-surface-secondary px-2 py-0.5 text-xs text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </ResultCardShell>
  );
}

/* -------------------------------------------------------------------------- */
/*                              YouTube Renderer                               */
/* -------------------------------------------------------------------------- */

function YouTubeResearchRenderer({ result }: BaseRendererProps) {
  // naive extraction of videoId from content or url
  const url = result.source.url ?? result.content;
  const idMatch = url.match(/(?:v=|be\/)\w{11}/);
  const videoId = idMatch ? idMatch[0].slice(-11) : undefined;
  if (!videoId) return null;
  return (
    <div className="my-2">
      <YoutubeEmbed videoId={videoId} title={result.title} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Markdown Renderer                               */
/* -------------------------------------------------------------------------- */

function MarkdownResearchRenderer({ result }: BaseRendererProps) {
  return (
    <ResultCardShell>
      <div className="max-w-none">
        <pre className="whitespace-pre-wrap text-sm text-secondary">{result.content}</pre>
      </div>
    </ResultCardShell>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Renderer registry helper                            */
/* -------------------------------------------------------------------------- */

export function getRendererForResult(result: ResearchResult) {
  // heuristics
  if (
    result.source.type === 'video' ||
    /(?:youtube\.com|youtu\.be)/i.test(result.content) ||
    /youtu/.test(result.source.url ?? '')
  ) {
    return YouTubeResearchRenderer;
  }
  if (result.source.type === 'wiki' || result.content.trim().startsWith('#')) {
    return MarkdownResearchRenderer;
  }
  return TextResearchRenderer;
}

// Export individual renderers for manual use
export const ResearchRenderers = {
  TextResearchRenderer,
  YouTubeResearchRenderer,
  MarkdownResearchRenderer,
};
