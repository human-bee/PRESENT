import { movieScriptContent } from "./doc-contents";

// Diff word type
export type DiffWord = {
  type: "added" | "removed";
  content: string;
  lineNumber: number;
  wordIndex: number;
};

// Define document type
export type Document = {
  id: string;
  name: string;
  description: string;
  content: string;
  titleImage?: string; // URL of the title image
  originalContent?: string; // Baseline content for diff comparison
  diffs?: DiffWord[];
  lastModified?: Date;
};

// Improved word-level diff algorithm that only tracks actual changes
export const generateWordDiff = (
  original: string,
  modified: string
): DiffWord[] => {
  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");
  const diffs: DiffWord[] = [];

  // Process each line
  for (
    let lineIndex = 0;
    lineIndex < Math.max(originalLines.length, modifiedLines.length);
    lineIndex++
  ) {
    const originalLine = originalLines[lineIndex] || "";
    const modifiedLine = modifiedLines[lineIndex] || "";

    // If lines are identical, skip
    if (originalLine === modifiedLine) continue;

    // Split lines into words (preserving whitespace)
    const originalWords = originalLine.split(/(\s+)/);
    const modifiedWords = modifiedLine.split(/(\s+)/);

    let i = 0,
      j = 0;
    let wordIndex = 0;

    while (i < originalWords.length || j < modifiedWords.length) {
      if (
        i < originalWords.length &&
        j < modifiedWords.length &&
        originalWords[i] === modifiedWords[j]
      ) {
        // Unchanged word - skip it
        i++;
        j++;
        wordIndex++;
      } else if (
        j < modifiedWords.length &&
        (i >= originalWords.length || originalWords[i] !== modifiedWords[j])
      ) {
        // Added word
        diffs.push({
          type: "added",
          content: modifiedWords[j],
          lineNumber: lineIndex + 1,
          wordIndex: wordIndex++,
        });
        j++;
      } else if (i < originalWords.length) {
        // Removed word
        diffs.push({
          type: "removed",
          content: originalWords[i],
          lineNumber: lineIndex + 1,
          wordIndex: wordIndex++,
        });
        i++;
      }
    }
  }

  return diffs;
};

// Shared state for document content
export const documentState: {
  documents: Document[];
  listeners: Set<(documents: Document[]) => void>;
  subscribe: (listener: (documents: Document[]) => void) => () => void;
  updateDocument: (id: string, content: string) => void;
  getDocuments: () => Document[];
  clearDiffs: (id: string) => void;
  setOriginalContent: (id: string, content: string) => void;
} = {
  documents: [
    {
      id: "movie-script-containment-breach",
      name: "Containment Breach",
      description: "A movie script for the movie 'Containment Breach'",
      titleImage: "/containment-breach.png",
      content: movieScriptContent,
      originalContent: movieScriptContent, // Set initial original content
      diffs: [],
      lastModified: new Date(),
    },
  ],
  listeners: new Set<(documents: Document[]) => void>(),

  // Subscribe to document changes
  subscribe: (listener: (documents: Document[]) => void) => {
    documentState.listeners.add(listener);
    return () => documentState.listeners.delete(listener);
  },

  // Update document content and calculate diffs
  updateDocument: (id: string, content: string) => {
    const docIndex = documentState.documents.findIndex(
      (doc: Document) => doc.id === id
    );
    if (docIndex !== -1) {
      const currentContent = documentState.documents[docIndex].content;
      const diffs = generateWordDiff(currentContent, content);

      // Only store diffs if there are actual changes
      const hasChanges = diffs.length > 0;

      documentState.documents[docIndex] = {
        ...documentState.documents[docIndex],
        content,
        diffs: hasChanges ? diffs : undefined,
        lastModified: new Date(),
      };
      // Notify all listeners
      documentState.listeners.forEach(
        (listener: (documents: Document[]) => void) =>
          listener([...documentState.documents])
      );
    }
  },

  // Set the original content for diff comparison
  setOriginalContent: (id: string, content: string) => {
    const docIndex = documentState.documents.findIndex(
      (doc: Document) => doc.id === id
    );
    if (docIndex !== -1) {
      documentState.documents[docIndex] = {
        ...documentState.documents[docIndex],
        originalContent: content,
        diffs: undefined, // Clear diffs when setting new original content
      };
      // Notify all listeners
      documentState.listeners.forEach(
        (listener: (documents: Document[]) => void) =>
          listener([...documentState.documents])
      );
    }
  },

  // Clear diffs for a document
  clearDiffs: (id: string) => {
    const docIndex = documentState.documents.findIndex(
      (doc: Document) => doc.id === id
    );
    if (docIndex !== -1) {
      documentState.documents[docIndex] = {
        ...documentState.documents[docIndex],
        diffs: undefined,
      };
      // Notify all listeners
      documentState.listeners.forEach(
        (listener: (documents: Document[]) => void) =>
          listener([...documentState.documents])
      );
    }
  },

  // Get current documents
  getDocuments: () => [...documentState.documents],
};
