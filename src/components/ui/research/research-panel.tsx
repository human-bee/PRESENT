'use client';

import { cn } from '@/lib/utils';
import { z } from 'zod';
import {
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Info,
  Bookmark,
  BookmarkCheck,
  GripVertical,
  Upload,
} from 'lucide-react';
import { getRendererForResult } from './research-renderers';
import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDropzone } from 'react-dropzone';

// Define the research result type
export const researchResultSchema = z.object({
  id: z.string().describe('Unique identifier for this research result'),
  title: z.string().describe('Title or headline of the research finding'),
  content: z.string().describe('Main content or summary of the research'),
  source: z
    .object({
      name: z.string().describe("Name of the source (e.g., 'Wikipedia', 'Reuters')"),
      url: z.string().optional().describe('URL to the original source'),
      credibility: z.enum(['high', 'medium', 'low']).describe('Credibility rating of the source'),
      type: z
        .enum(['news', 'academic', 'wiki', 'blog', 'social', 'government', 'other'])
        .describe('Type of source'),
    })
    .describe('Source information and metadata'),
  relevance: z.number().min(0).max(100).describe('Relevance score (0-100) to the current topic'),
  timestamp: z.string().describe('When this research was conducted or published'),
  tags: z.array(z.string()).optional().describe('Topic tags associated with this research'),
  factCheck: z
    .object({
      status: z
        .enum(['verified', 'disputed', 'unverified', 'false'])
        .describe('Fact-checking status'),
      confidence: z.number().min(0).max(100).describe('Confidence level in the fact-check'),
    })
    .optional()
    .describe('Fact-checking information if available'),
});

// Main component schema
export const researchPanelSchema = z.object({
  title: z.string().optional().describe('Title displayed at the top of the panel'),
  results: z.array(researchResultSchema).describe('Array of research results to display'),
  currentTopic: z.string().optional().describe('Current topic being researched'),
  isLive: z.boolean().optional().describe('Whether this is showing live research results'),
  maxResults: z.number().optional().describe('Maximum number of results to show'),
  showCredibilityFilter: z
    .boolean()
    .optional()
    .describe('Whether to show credibility filtering options'),
});

export type ResearchPanelProps = z.infer<typeof researchPanelSchema>;
export type ResearchResult = z.infer<typeof researchResultSchema>;

// Component state type
type ResearchPanelState = {
  bookmarkedResults: string[];
  selectedCredibility: 'all' | 'high' | 'medium' | 'low';
  selectedSourceTypes: string[];
  expandedResults: string[];
  sortBy: 'relevance' | 'timestamp' | 'credibility';
};

// Credibility badge component
function CredibilityBadge({
  level,
  className,
}: { level: 'high' | 'medium' | 'low'; className?: string }) {
  const styles = {
    high: 'bg-green-100 text-green-800 border-green-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-red-100 text-red-800 border-red-200',
  };

  const icons = {
    high: CheckCircle,
    medium: AlertTriangle,
    low: AlertTriangle,
  };

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

// Fact-check badge component
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
  };

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

// Source type badge component
function SourceTypeBadge({ type, className }: { type: string; className?: string }) {
  const colors = {
    news: 'bg-blue-100 text-blue-800',
    academic: 'bg-purple-100 text-purple-800',
    wiki: 'bg-gray-100 text-gray-800',
    blog: 'bg-orange-100 text-orange-800',
    social: 'bg-pink-100 text-pink-800',
    government: 'bg-indigo-100 text-indigo-800',
    other: 'bg-gray-100 text-gray-800',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium',
        colors[type as keyof typeof colors] || colors.other,
        className,
      )}
    >
      {type}
    </span>
  );
}

// Individual research result card
function ResearchResultCard({
  result,
  isBookmarked,
  isExpanded,
  onToggleBookmark,
  onToggleExpanded,
}: {
  result: ResearchResult;
  isBookmarked: boolean;
  isExpanded: boolean;
  onToggleBookmark: () => void;
  onToggleExpanded: () => void;
}) {
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

      {/* Tags */}
      {result.tags && result.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {result.tags.map((tag, index) => (
            <span
              key={index}
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

// Main ResearchPanel component
export function ResearchPanel({
  title = 'Research Panel',
  results = [] as ResearchResult[],
  currentTopic,
  isLive = false,
  maxResults = 10,
  showCredibilityFilter = true,
  className,
  ...props
}: ResearchPanelProps & React.HTMLAttributes<HTMLDivElement>) {
  // Strip custom shape injection props so they don't leak onto the DOM
  const domProps = { ...(props as any) } as Record<string, unknown>;
  delete (domProps as any).updateState;
  delete (domProps as any).state;
  delete (domProps as any).__custom_message_id;
  // Local component state
  const [state, setState] = useState<ResearchPanelState>({
    bookmarkedResults: [],
    selectedCredibility: 'all',
    selectedSourceTypes: [],
    expandedResults: [],
    sortBy: 'relevance',
  });

  // Local state for items added via drag-and-drop
  const [customResults, setCustomResults] = useState<ResearchResult[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Order state for drag-reorder (local for now – can be persisted via custom later)
  const [order, setOrder] = useState<string[]>([]);

  // Synchronise order when result list changes (add new ids at the end)
  useEffect(() => {
    const ids = [...customResults, ...results].map((r) => r.id);
    setOrder((prev) => {
      const next = [...prev];
      ids.forEach((id) => {
        if (!next.includes(id)) next.push(id);
      });
      return next.filter((id) => ids.includes(id)); // prune removed
    });
  }, [customResults.length, results.length]);

  // DnD sensors
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor));

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active?.id && over?.id && active.id !== over.id) {
      setOrder((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Dropzone for files (react-dropzone takes care of drag events throttling)
  const onDrop = useCallback((acceptedFiles: File[], _rejects, evt) => {
    handleDrop(evt as unknown as React.DragEvent<HTMLDivElement>);
  }, []);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFileDialog,
  } = useDropzone({ onDrop, noKeyboard: true, noClick: true });

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const newResults: ResearchResult[] = [];

    // 1. Files dropped
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((file) => {
        const objectUrl = URL.createObjectURL(file);
        newResults.push({
          id: crypto.randomUUID(),
          title: file.name,
          content: objectUrl,
          source: {
            name: 'Local File',
            url: objectUrl,
            credibility: 'high',
            type: 'other',
          },
          relevance: 0,
          timestamp: new Date().toISOString(),
          tags: [file.type.split('/')[0] || 'file'],
        } as ResearchResult);
      });
    }

    // 2. Links / text dropped
    const uriList = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uriList) {
      uriList.split(/\n/).forEach((uri) => {
        const trimmed = uri.trim();
        if (trimmed) {
          newResults.push({
            id: crypto.randomUUID(),
            title: trimmed,
            content: trimmed,
            source: {
              name: 'Dropped Link',
              url: trimmed,
              credibility: 'medium',
              type: /youtube|youtu\.be/.test(trimmed) ? 'video' : 'other',
            },
            relevance: 0,
            timestamp: new Date().toISOString(),
          } as ResearchResult);
        }
      });
    }

    if (newResults.length) {
      setCustomResults((prev) => [...newResults, ...prev]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  // Combine custom dropped results with supplied ones (custom appear first)
  const combinedResults = [...customResults, ...results];

  // Apply ordering from dnd
  const orderedResults = order
    .map((id) => combinedResults.find((r) => r.id === id))
    .filter(Boolean) as ResearchResult[];

  // Filter and sort results
  const filteredResults = orderedResults
    .filter((result) => {
      // Credibility filter
      if (state?.selectedCredibility && state.selectedCredibility !== 'all') {
        if (result.source.credibility !== state.selectedCredibility) return false;
      }

      // Source type filter
      if (state?.selectedSourceTypes && state.selectedSourceTypes.length > 0) {
        if (!state.selectedSourceTypes.includes(result.source.type)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (!state?.sortBy) return 0;

      switch (state.sortBy) {
        case 'relevance':
          return b.relevance - a.relevance;
        case 'timestamp':
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        case 'credibility':
          const credibilityScore = { high: 3, medium: 2, low: 1 };
          return credibilityScore[b.source.credibility] - credibilityScore[a.source.credibility];
        default:
          return 0;
      }
    })
    .slice(0, maxResults);

  // Handle bookmark toggle
  const toggleBookmark = (resultId: string) => {
    if (!state) return;

    const bookmarked = [...state.bookmarkedResults];
    const index = bookmarked.indexOf(resultId);

    if (index > -1) {
      bookmarked.splice(index, 1);
    } else {
      bookmarked.push(resultId);
    }

    setState({ ...state, bookmarkedResults: bookmarked });
  };

  // Handle expand toggle
  const toggleExpanded = (resultId: string) => {
    if (!state) return;

    const expanded = [...state.expandedResults];
    const index = expanded.indexOf(resultId);

    if (index > -1) {
      expanded.splice(index, 1);
    } else {
      expanded.push(resultId);
    }

    setState({ ...state, expandedResults: expanded });
  };

  // Get unique source types for filter
  const availableSourceTypes = [...new Set(results.map((r) => r.source.type))];

  return (
    <div className={cn('w-full max-w-4xl mx-auto', className)} {...(domProps as any)}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              {title}
              {isLive && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  Live
                </span>
              )}
            </h2>
            {currentTopic && (
              <p className="text-sm text-gray-600 mt-1">
                Researching: <span className="font-medium">{currentTopic}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>
              {filteredResults.length} of {combinedResults.length} results
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFileDialog();
              }}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>
        </div>

        {/* Filters */}
        {showCredibilityFilter && (
          <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg">
            {/* Credibility Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Credibility:</label>
              <select
                value={state?.selectedCredibility || 'all'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    selectedCredibility: e.target.value as typeof state.selectedCredibility,
                  })
                }
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Sort By */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Sort by:</label>
              <select
                value={state?.sortBy || 'relevance'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    sortBy: e.target.value as typeof state.sortBy,
                  })
                }
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="relevance">Relevance</option>
                <option value="timestamp">Time</option>
                <option value="credibility">Credibility</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div
        {...getRootProps()}
        className={cn(
          'space-y-4 relative',
          (isDragOver || isDragActive) && 'ring-2 ring-blue-400 ring-offset-2',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input {...getInputProps()} />
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 pointer-events-none">
            <p className="text-lg font-medium text-blue-600">Drop files or links to add</p>
          </div>
        )}
        {filteredResults.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">
              <Info className="w-12 h-12 mx-auto" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No research results</h3>
            <p className="text-gray-600">
              {results.length === 0
                ? 'Start a conversation to see research results appear here.'
                : 'Try adjusting your filters to see more results.'}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredResults.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredResults.map((result) => {
                const Renderer = getRendererForResult(result);
                return (
                  <SortableItem key={result.id} id={result.id}>
                    <Renderer
                      result={result}
                      isBookmarked={state?.bookmarkedResults.includes(result.id) || false}
                      isExpanded={state?.expandedResults.includes(result.id) || false}
                      onToggleBookmark={() => toggleBookmark(result.id)}
                      onToggleExpanded={() => toggleExpanded(result.id)}
                    />
                  </SortableItem>
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Load More */}
      {results.length > maxResults && (
        <div className="text-center mt-6">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Load More Results
          </button>
        </div>
      )}
    </div>
  );
}

export default ResearchPanel;

// SortableItem component
function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Drag handle */}
      <button
        ref={setActivatorNodeRef as unknown as React.Ref<HTMLButtonElement>}
        {...attributes}
        {...listeners}
        className="absolute -left-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 cursor-grab"
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      {children}
    </div>
  );
}
