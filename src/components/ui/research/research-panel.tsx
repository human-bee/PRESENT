'use client';

import { cn } from '@/lib/utils';
import { useComponentRegistration } from '@/lib/component-registry';
import { z } from 'zod';
import {
  Info,
  GripVertical,
  Upload,
} from 'lucide-react';
import { getRendererForResult } from './research-renderers';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { WidgetFrame } from '@/components/ui/productivity/widget-frame';
import { Button } from '@/components/ui/shared/button';

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
const researchPanelPartialSchema = researchPanelSchema.partial();

type ResearchPanelHostProps = ResearchPanelProps &
  React.HTMLAttributes<HTMLDivElement> & { __custom_message_id?: string };

// Component state type
type ResearchPanelState = {
  bookmarkedResults: string[];
  selectedCredibility: 'all' | 'high' | 'medium' | 'low';
  selectedSourceTypes: string[];
  expandedResults: string[];
  sortBy: 'relevance' | 'timestamp' | 'credibility';
};

// Main ResearchPanel component
const coerceResults = (value: unknown): ResearchResult[] =>
  Array.isArray(value) ? (value as ResearchResult[]) : ([] as ResearchResult[]);

export function ResearchPanel(props: ResearchPanelHostProps) {
  const {
    className,
    __custom_message_id,
    title: incomingTitleRaw,
    results: incomingResultsRaw,
    currentTopic: incomingCurrentTopic,
    isLive: incomingIsLive,
    maxResults: incomingMaxResults,
    showCredibilityFilter: incomingShowCredibilityFilter,
    ...restDomProps
  } = props;

  // Strip custom shape injection props so they don't leak onto the DOM
  const domProps = { ...(restDomProps as Record<string, unknown>) };
  delete domProps.updateState;
  delete domProps.state;
  delete domProps.__custom_message_id;

  const [panelProps, setPanelProps] = useState(() => ({
    title: incomingTitleRaw ?? 'Research Panel',
    results: coerceResults(incomingResultsRaw),
    currentTopic: incomingCurrentTopic,
    isLive: incomingIsLive ?? false,
    maxResults: typeof incomingMaxResults === 'number' ? incomingMaxResults : 10,
    showCredibilityFilter:
      typeof incomingShowCredibilityFilter === 'boolean' ? incomingShowCredibilityFilter : true,
  }));

  useEffect(() => {
    const nextProps = {
      title: incomingTitleRaw ?? 'Research Panel',
      results: coerceResults(incomingResultsRaw),
      currentTopic: incomingCurrentTopic,
      isLive: incomingIsLive ?? false,
      maxResults: typeof incomingMaxResults === 'number' ? incomingMaxResults : 10,
      showCredibilityFilter:
        typeof incomingShowCredibilityFilter === 'boolean' ? incomingShowCredibilityFilter : true,
    };
    setPanelProps((prev) => {
      if (
        prev.title === nextProps.title &&
        prev.currentTopic === nextProps.currentTopic &&
        prev.isLive === nextProps.isLive &&
        prev.maxResults === nextProps.maxResults &&
        prev.showCredibilityFilter === nextProps.showCredibilityFilter &&
        prev.results === nextProps.results
      ) {
        return prev;
      }
      return nextProps;
    });
  }, [
    incomingTitleRaw,
    incomingResultsRaw,
    incomingCurrentTopic,
    incomingIsLive,
    incomingMaxResults,
    incomingShowCredibilityFilter,
  ]);

  const title = panelProps.title ?? 'Research Panel';
  const results = panelProps.results ?? ([] as ResearchResult[]);
  const currentTopic = panelProps.currentTopic;
  const isLive = panelProps.isLive ?? false;
  const maxResults = panelProps.maxResults ?? 10;
  const showCredibilityFilter = panelProps.showCredibilityFilter ?? true;

  const fallbackMessageIdRef = useRef<string>();
  if (!fallbackMessageIdRef.current) {
    fallbackMessageIdRef.current = `research-panel-${crypto.randomUUID()}`;
  }
  const messageId = (__custom_message_id?.trim() || fallbackMessageIdRef.current)!;

  const handleRegistryUpdate = useCallback((patch: Record<string, unknown>) => {
    const merged = (patch as { __mergedProps?: ResearchPanelProps }).__mergedProps;
    const source = merged ?? patch;
    const parsed = researchPanelPartialSchema.safeParse(source);
    if (!parsed.success) {
      return;
    }
    const data = parsed.data;
    setPanelProps((prev) => ({
      title: data.title ?? prev.title,
      results: data.results ? coerceResults(data.results) : prev.results,
      currentTopic: typeof data.currentTopic === 'string' ? data.currentTopic : prev.currentTopic,
      isLive: typeof data.isLive === 'boolean' ? data.isLive : prev.isLive,
      maxResults: typeof data.maxResults === 'number' ? data.maxResults : prev.maxResults,
      showCredibilityFilter:
        typeof data.showCredibilityFilter === 'boolean'
          ? data.showCredibilityFilter
          : prev.showCredibilityFilter,
    }));
  }, []);

  const registryPayload = useMemo(
    () => ({ title, results, currentTopic, isLive, maxResults, showCredibilityFilter }),
    [title, results, currentTopic, isLive, maxResults, showCredibilityFilter],
  );

  useComponentRegistration(messageId, 'ResearchPanel', registryPayload, 'canvas', handleRegistryUpdate);

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
  }, [customResults, results]);

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

  return (
    <div className={cn('w-full max-w-4xl mx-auto', className)} {...(domProps as any)}>
      <WidgetFrame
        title={
          <div className="flex items-center gap-2">
            <span>{title}</span>
            {isLive ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-danger-outline bg-danger-surface px-2 py-1 text-xs font-medium text-danger">
                <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
                Live
              </span>
            ) : null}
          </div>
        }
        subtitle={
          currentTopic ? (
            <span>
              Researching: <span className="font-medium text-primary">{currentTopic}</span>
            </span>
          ) : undefined
        }
        meta={
          <span>
            {filteredResults.length} of {combinedResults.length} results
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openFileDialog();
            }}
            className="hover:bg-surface-secondary"
          >
            <Upload className="h-4 w-4" /> Upload
          </Button>
        }
        bodyClassName="space-y-4"
      >
        {showCredibilityFilter ? (
          <div className="flex flex-wrap gap-4 rounded-xl border border-default bg-surface-secondary p-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-secondary">Credibility:</label>
              <select
                value={state?.selectedCredibility || 'all'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    selectedCredibility: e.target.value as typeof state.selectedCredibility,
                  })
                }
                className="rounded-lg border border-default bg-surface px-2 py-1 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              >
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-secondary">Sort by:</label>
              <select
                value={state?.sortBy || 'relevance'}
                onChange={(e) =>
                  state &&
                  setState({
                    ...state,
                    sortBy: e.target.value as typeof state.sortBy,
                  })
                }
                className="rounded-lg border border-default bg-surface px-2 py-1 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
              >
                <option value="relevance">Relevance</option>
                <option value="timestamp">Time</option>
                <option value="credibility">Credibility</option>
              </select>
            </div>
          </div>
        ) : null}

        <div
          {...getRootProps()}
          className={cn(
            'relative space-y-4',
            (isDragOver || isDragActive) &&
              'ring-2 ring-[var(--present-accent-ring)] ring-offset-2 ring-offset-[var(--present-surface)]',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input {...getInputProps()} />
          {isDragOver ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-surface/80">
              <p className="text-lg font-medium text-[var(--present-accent)]">
                Drop files or links to add
              </p>
            </div>
          ) : null}

          {filteredResults.length === 0 ? (
            <div className="py-12 text-center">
              <div className="mb-2 text-tertiary">
                <Info className="mx-auto h-12 w-12" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-primary">No research results</h3>
              <p className="text-secondary">
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

        {results.length > maxResults ? (
          <div className="pt-2 text-center">
            <Button>Load More Results</Button>
          </div>
        ) : null}
      </WidgetFrame>
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
        className="absolute -left-2 top-1/2 -translate-y-1/2 cursor-grab rounded p-1 text-tertiary hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      {children}
    </div>
  );
}
