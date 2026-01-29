'use client';

import { useCallback, useMemo } from 'react';
import { useEditor } from '@tldraw/tldraw';
import { useCanvasContext } from '@/lib/hooks/use-canvas-context';
import {
  DEFAULT_FAIRY_CONTEXT_PROFILE,
  getFairyContextLimits,
  getFairyContextSpectrum,
  normalizeFairyContextProfile,
  resolveProfileFromSpectrum,
  type FairyContextProfile,
} from './profiles';
import type { FairyContextBundle, FairyContextPart } from './types';
import {
  buildCustomShapeSnapshots,
  safeJsonPreview,
  summarizeWidgetHistory,
  truncateText,
} from './bundle-utils';

export type { FairyContextBundle, FairyContextPart } from './types';

export function useFairyContextBundle() {
  const editor = useEditor();
  const { getPromptContext, widgets, documents, transcripts } = useCanvasContext();

  const transcriptCount = useMemo(
    () => transcripts.filter((t) => t.isFinal).length,
    [transcripts],
  );

  return useCallback(
    ({
      selectionIds = [],
      metadata,
      profile,
      spectrum,
    }: {
      selectionIds?: string[];
      metadata?: unknown;
      profile?: FairyContextProfile | string;
      spectrum?: number | string;
    } = {}): FairyContextBundle => {
      const parts: FairyContextPart[] = [];
      const resolvedProfile =
        normalizeFairyContextProfile(profile) ??
        resolveProfileFromSpectrum(spectrum) ??
        DEFAULT_FAIRY_CONTEXT_PROFILE;
      const limits = getFairyContextLimits(resolvedProfile);
      let customShapeCount = 0;

      const promptContext = getPromptContext({
        transcriptLines: limits.TRANSCRIPT_LINES,
        maxDocumentLength: limits.MAX_DOCUMENT_LENGTH,
        includeWidgets: false,
      });

      if (promptContext) {
        parts.push({
          type: 'present_context',
          text: truncateText(promptContext, limits.MAX_CONTEXT_CHARS),
        });
      }

      if (documents && documents.length > 0) {
        const docs = documents.slice(0, limits.MAX_DOCUMENTS).map((doc) => ({
          title: doc.title,
          type: doc.type,
          preview: truncateText(doc.content, limits.MAX_DOCUMENT_LENGTH),
        }));
        parts.push({ type: 'documents', documents: docs });
      }

      if (widgets && widgets.length > 0) {
        const widgetSnapshots = widgets.slice(0, limits.MAX_WIDGETS).map((widget) => ({
          componentType: widget.componentType,
          messageId: widget.messageId,
          props: safeJsonPreview(widget.props, limits.MAX_STATE_CHARS),
          lastUpdated: widget.lastUpdated ?? null,
          history: summarizeWidgetHistory(
            (widget as any).diffHistory as Array<{ key: string; next: unknown; ts: number }> | undefined,
            limits.MAX_WIDGET_HISTORY,
            Math.round(limits.MAX_STATE_CHARS / 4),
          ),
        }));
        parts.push({ type: 'widgets', widgets: widgetSnapshots });
      }

      if (editor) {
        const customSnapshots = buildCustomShapeSnapshots(
          editor,
          limits.MAX_CUSTOM_SHAPES,
          limits.MAX_STATE_CHARS,
        );
        if (customSnapshots.length > 0) {
          parts.push({ type: 'canvas_components', items: customSnapshots });
          customShapeCount = customSnapshots.length;
        }
      }

      if (metadata !== undefined && metadata !== null) {
        parts.push({
          type: 'dispatch_metadata',
          metadata: safeJsonPreview(metadata, limits.MAX_STATE_CHARS),
        });
      }

      if (selectionIds.length > 0) {
        parts.push({
          type: 'selection_ids',
          ids: selectionIds.slice(0, limits.MAX_SELECTION_IDS),
        });
      }

      return {
        parts,
        summary: {
          transcriptLines: Math.min(transcriptCount, limits.TRANSCRIPT_LINES),
          documents: documents.length,
          widgets: widgets.length,
          selectionIds: selectionIds.length,
          customShapes: customShapeCount,
          profile: resolvedProfile,
          spectrum: getFairyContextSpectrum(resolvedProfile).value,
        },
      };
    },
    [documents, editor, getPromptContext, transcriptCount, widgets],
  );
}
