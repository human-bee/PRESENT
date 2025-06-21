import { movieScriptContent } from "./doc-contents";

// Define document type
export type Document = {
  id: string;
  name: string;
  description: string;
  content: string;
};

// Shared state for document content
export const documentState: {
  documents: Document[];
  listeners: Set<(documents: Document[]) => void>;
  subscribe: (listener: (documents: Document[]) => void) => () => void;
  updateDocument: (id: string, content: string) => void;
  getDocuments: () => Document[];
} = {
  documents: [
    {
      id: "movie-script",
      name: "movie script",
      description: "A movie script",
      content: movieScriptContent,
    },
  ],
  listeners: new Set<(documents: Document[]) => void>(),

  // Subscribe to document changes
  subscribe: (listener: (documents: Document[]) => void) => {
    documentState.listeners.add(listener);
    return () => documentState.listeners.delete(listener);
  },

  // Update document content
  updateDocument: (id: string, content: string) => {
    const docIndex = documentState.documents.findIndex(
      (doc: Document) => doc.id === id
    );
    if (docIndex !== -1) {
      documentState.documents[docIndex] = {
        ...documentState.documents[docIndex],
        content,
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
