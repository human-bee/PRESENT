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
            originalContent: z.string().optional(),
            diffs: z
              .array(
                z.object({
                  type: z.enum(["unchanged", "added", "removed"]),
                  content: z.string(),
                  lineNumber: z.number(),
                })
              )
              .optional(),
            lastModified: z.date().optional(),
          })
        )
      ),
  },
  {
    name: "edit_document_content",
    description:
      "Edit the content of a specific document. This will update the document in real-time and any open document viewers will see the changes immediately. Diffs will be calculated against the original content.",
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
  {
    name: "set_original_content",
    description:
      "Set the original content for a document. This will be used as the baseline for diff calculations. Useful for resetting the diff comparison point.",
    tool: async (documentId: string, originalContent: string) => {
      documentState.setOriginalContent(documentId, originalContent);
      return {
        success: true,
        message: `Original content for document "${documentId}" has been set.`,
        documentId,
      };
    },
    toolSchema: z
      .function()
      .args(
        z.string().describe("The id of the document"),
        z.string().describe("The original content to use for diff comparison")
      )
      .returns(
        z.object({
          success: z.boolean(),
          message: z.string(),
          documentId: z.string(),
        })
      ),
  },
  {
    name: "clear_diffs",
    description:
      "Clear the diff information for a document. This will hide the diff view.",
    tool: async (documentId: string) => {
      documentState.clearDiffs(documentId);
      return {
        success: true,
        message: `Diffs for document "${documentId}" have been cleared.`,
        documentId,
      };
    },
    toolSchema: z
      .function()
      .args(z.string().describe("The id of the document"))
      .returns(
        z.object({
          success: z.boolean(),
          message: z.string(),
          documentId: z.string(),
        })
      ),
  },
];

export const availableDocs = documentState.getDocuments();
