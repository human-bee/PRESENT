import MarkdownViewerEditable from '@/components/ui/markdown-viewer-editable';
import { useEffect, useState } from 'react';
import { Document, documentState } from '../../../app/hackathon-canvas/documents/document-state';

export default function DocumentViewerWrapper({
  documentId,
}: {
  documentId: string;
}) {
  console.log('documentId', documentId);
  const [document, setDocument] = useState<Document | null>(null);

  useEffect(() => {
    if (documentId) {
      console.log('documentId', documentId);
      // Get initial document
      const documents = documentState.getDocuments();
      const doc = documents.find((d) => d.id === documentId);
      console.log('document', doc);
      setDocument(doc || null);

      // Subscribe to document changes
      const unsubscribe = documentState.subscribe((documents) => {
        const updatedDoc = documents.find((d) => d.id === documentId);
        if (updatedDoc) {
          console.log('Document updated:', updatedDoc);
          setDocument(updatedDoc);
        }
      });

      // Cleanup subscription on unmount
      return unsubscribe;
    }
  }, [documentId]);

  if (!document) {
    return <div>Loading...</div>;
  }

  return (
    <MarkdownViewerEditable
      content={document?.content || ''}
      title={document?.name || ''}
      titleImage={document?.titleImage}
      diffs={document?.diffs}
    />
  );
}
