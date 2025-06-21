import { TamboComponent, TamboTool } from "@tambo-ai/react";
import { z } from "zod";
import { documentState } from "./document-state";
import DocumentViewerWrapper from "./document-viewer-wrapper";

export const testComponents: TamboComponent[] = [
  {
    name: "DocumentEditor",
    description:
      "A markdown document editor. Allows the user to edit the contents of a document.",
    component: DocumentViewerWrapper,
    propsSchema: z.object({
      documentId: z.string().describe("The id of the document to edit."),
    }),
  },
];

export const tamboTools: TamboTool[] = [
  {
    name: "get_available_docs",
    description: "Get a list of all the available documents.",
    tool: async () => {
      return documentState.getDocuments();
    },
    toolSchema: z
      .function()
      .args()
      .returns(
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            content: z.string(),
          })
        )
      ),
  },
  {
    name: "edit_document_content",
    description:
      "Edit the content of a specific document. This will update the document in real-time and any open document viewers will see the changes immediately.",
    tool: async (documentId: string, newContent: string) => {
      documentState.updateDocument(documentId, newContent);
      return {
        success: true,
        message: `Document "${documentId}" has been updated successfully.`,
        documentId,
        contentLength: newContent.length,
      };
    },
    toolSchema: z
      .function()
      .args(
        z.string().describe("The id of the document to edit"),
        z.string().describe("The new content for the document")
      )
      .returns(
        z.object({
          success: z.boolean(),
          message: z.string(),
          documentId: z.string(),
          contentLength: z.number(),
        })
      ),
  },
];

export const availableDocs = documentState.getDocuments();
