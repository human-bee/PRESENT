import MarkdownViewerEditable from "@/components/ui/markdown-viewer-editable";
import { useEffect, useState } from "react";
import { availableDocs } from "./test-tambo-setup";

export default function DocumentViewerWrapper({
  documentId,
}: {
  documentId: string;
}) {
  console.log("documentId", documentId);
  const [document, setDocument] = useState<(typeof availableDocs)[0] | null>(
    null
  );
  useEffect(() => {
    if (documentId) {
      console.log("documentId", documentId);
      const document = availableDocs.find((doc) => doc.id === documentId);
      console.log("document", document);
      setDocument(document || null);
    }
  }, [documentId]);

  if (!document) {
    return <div>Loading...</div>;
  }

  return (
    <MarkdownViewerEditable
      content={document?.content || ""}
      title={document?.name || ""}
    />
  );
}
