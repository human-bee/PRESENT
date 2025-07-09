import { useCallback, useEffect } from "react";
import {
  Document,
  documentState,
  generateWordDiff,
} from "@/app/hackathon-canvas/documents/document-state";
import { MarkdownViewerEditable } from "@/components/ui/hackathon/markdown-viewer-editable";
import { useTamboComponentState } from "@tambo-ai/react";
import { useComponentRegistration } from "@/lib/component-registry";
import { z } from "zod";

export interface DocumentEditorProps {
  documentId: string;
  __tambo_message_id?: string; // injected automatically when rendered by Tambo
}

// Schema for Tambo registration
export const documentEditorSchema = z.object({
  documentId: z.string().describe("ID of the document to edit"),
});

// Internal state stored via Tambo hook so AI can update via ui_update
type EditorState = {
  content: string;
  originalContent: string;
  diffs: Document["diffs"];
};

export function DocumentEditor({
  documentId,
  __tambo_message_id,
}: DocumentEditorProps) {
  // Generate effective message ID
  const effectiveMessageId = __tambo_message_id || `document-editor-${documentId}`;
  
  // Fetch initial document
  const initialDoc = documentState
    .getDocuments()
    .find((d) => d.id === documentId);

  const [state, setState] = useTamboComponentState<EditorState>(
    // unique component id
    `document-editor-${documentId}`,
    {
      content: initialDoc?.content || "",
      originalContent: initialDoc?.originalContent || initialDoc?.content || "",
      diffs: initialDoc?.diffs || [],
    }
  );

  // Helper to update content with diff calculation
  const updateContent = useCallback((newContent: string) => {
    if (!state) return;
    const newDiffs = generateWordDiff(state.originalContent, newContent);
    setState(prev => prev ? { ...prev, content: newContent, diffs: newDiffs } : prev);
  }, [state, setState]);

  // Keep local state in sync with shared documentState
  useEffect(() => {
    const unsubscribe = documentState.subscribe((docs) => {
      const updated = docs.find((d) => d.id === documentId);
      if (updated) {
        setState((prev) =>
          prev
            ? {
                ...prev,
                content: updated.content,
                originalContent: updated.originalContent || updated.content,
                diffs: updated.diffs,
              }
            : prev
        );
      }
    });
    return unsubscribe;
  }, [documentId, setState]);

  // Whenever our state.content changes (e.g., AI update), update global documentState
  useEffect(() => {
    if (!state) return;
    documentState.updateDocument(documentId, state.content);
  }, [state?.content, documentId]);

  // AI update handler
  const handleAIUpdate = useCallback((patch: Record<string, unknown>) => {
    if ('content' in patch && typeof patch.content === 'string') {
      updateContent(patch.content);
    }
  }, [updateContent]);

  // Register with ComponentRegistry for AI updates
  useComponentRegistration(
    effectiveMessageId,
    'DocumentEditor',
    { documentId, content: state?.content || '' },
    'default',
    handleAIUpdate
  );

  if (!state) return <div>Loading document...</div>;

  return (
    <MarkdownViewerEditable
      content={state.content}
      title={initialDoc?.name || 'Document'}
      titleImage={initialDoc?.titleImage}
      diffs={state.diffs}
    />
  );
}

// Default export for compatibility
export default DocumentEditor; 