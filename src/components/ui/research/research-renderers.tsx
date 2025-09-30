import React from 'react';
import dynamic from 'next/dynamic';
import { ResearchResult } from './research/research-panel';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Info,
  Bookmark,
  BookmarkCheck,
  MessageCircle,
  FileText,
  Layout,
} from 'lucide-react';
import { useToolDispatcher } from '../tool-dispatcher';

// Dynamic import for YouTube embed - only load when needed
const YoutubeEmbed = dynamic(
  () => import('./youtube-embed').then((mod) => ({ default: mod.YoutubeEmbed })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-4 bg-gray-50 rounded">
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
/*                           Credibility sub-components                        */
/* -------------------------------------------------------------------------- */

function CredibilityBadge({
  level,
  className,
}: { level: 'high' | 'medium' | 'low'; className?: string }) {
  const styles = {
    high: 'bg-green-100 text-green-800 border-green-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-red-100 text-red-800 border-red-200',
  } as const;
  const icons = { high: CheckCircle, medium: AlertTriangle, low: AlertTriangle } as const;
  const Icon = icons[level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
        styles[level],
        className,
      )}
    >
      <Icon className="w-3 h-3" />
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

function FactCheckBadge({
  factCheck,
  className,
}: { factCheck: ResearchResult['factCheck']; className?: string }) {
  if (!factCheck) return null;
  const styles = {
    verified: 'bg-green-100 text-green-800 border-green-200',
    disputed: 'bg-orange-100 text-orange-800 border-orange-200',
    unverified: 'bg-gray-100 text-gray-800 border-gray-200',
    false: 'bg-red-100 text-red-800 border-red-200',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
        styles[factCheck.status],
        className,
      )}
    >
      <Info className="w-3 h-3" />
      {factCheck.status} ({factCheck.confidence}%)
    </span>
  );
}

function SourceTypeBadge({ type, className }: { type: string; className?: string }) {
  const colors = {
    news: 'bg-blue-100 text-blue-800',
    academic: 'bg-purple-100 text-purple-800',
    wiki: 'bg-gray-100 text-gray-800',
    blog: 'bg-orange-100 text-orange-800',
    social: 'bg-pink-100 text-pink-800',
    government: 'bg-indigo-100 text-indigo-800',
    other: 'bg-gray-100 text-gray-800',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium',
        //@ts-expect-error – fallback guard
        colors[type as keyof typeof colors] || colors.other,
        className,
      )}
    >
      {type}
    </span>
  );
}

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
    <div className="flex items-center gap-3 mt-3">
      <button
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
        onClick={() =>
          fire('generate_ui_component', {
            componentType: 'message_thread',
            prompt: `Discuss research finding: ${result.title}`,
          })
        }
      >
        <MessageCircle className="w-4 h-4" /> Discuss
      </button>
      <button
        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
        onClick={() =>
          fire('generate_ui_component', {
            componentType: 'summary',
            prompt: `Summarize research finding: ${result.title}`,
          })
        }
      >
        <FileText className="w-4 h-4" /> Summarize
      </button>
      <button
        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800"
        onClick={() =>
          fire('generate_ui_component', {
            componentType: 'presentation_deck',
            prompt: `Add slide for research finding: ${result.title}`,
          })
        }
      >
        <Layout className="w-4 h-4" /> Add to Deck
      </button>
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
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-5 line-clamp-2">
            {result.title}
          </h3>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-600">{result.source.name}</span>
            <CredibilityBadge level={result.source.credibility} />
            <SourceTypeBadge type={result.source.type} />
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggleBookmark}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          >
            {isBookmarked ? (
              <BookmarkCheck className="w-4 h-4 text-blue-600" />
            ) : (
              <Bookmark className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {result.source.url && (
            <a
              href={result.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded hover:bg-gray-100 transition-colors"
              title="Open source"
            >
              <ExternalLink className="w-4 h-4 text-gray-400" />
            </a>
          )}
        </div>
      </div>
      {/* Content */}
      <div className="mb-3">
        <p className={cn('text-sm text-gray-700 leading-relaxed', !isExpanded && 'line-clamp-3')}>
          {result.content}
        </p>
        {result.content.length > 200 && (
          <button
            onClick={onToggleExpanded}
            className="text-xs text-blue-600 hover:text-blue-800 mt-1 font-medium"
          >
            {isExpanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>
      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Relevance: {result.relevance}%</span>
          {result.factCheck && <FactCheckBadge factCheck={result.factCheck} />}
        </div>
        <span className="text-xs text-gray-400">
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
              className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
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
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="prose prose-sm max-w-none">
        <pre className="whitespace-pre-wrap text-sm text-gray-700">{result.content}</pre>
      </div>
    </div>
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
