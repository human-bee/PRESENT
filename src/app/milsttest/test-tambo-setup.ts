import { TamboComponent, TamboTool } from "@tambo-ai/react";
import { z } from "zod";
import { movieScriptContent } from "./doc-contents";
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
      return availableDocs;
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
];

export const availableDocs = [
  {
    id: "movie-script",
    name: "movie script",
    description: "A movie script",
    content: movieScriptContent,
  },
];
