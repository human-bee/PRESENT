import {
  MarkdownViewerEditable,
  markdownViewerEditableSchema,
} from "@/components/ui/markdown-viewer-editable";
import { TamboComponent, TamboTool } from "@tambo-ai/react";
import { z } from "zod";
import { docContents } from "./doc-contents";

export const testComponents: TamboComponent[] = [
  {
    name: "EditableMarkdownViewer",
    description:
      "A markdown document viewer with tile preview and full-screen reading mode. Displays markdown content with PP Editorial New typography on a black background. Perfect for displaying documentation, articles, or any markdown content with an elegant reading experience.",
    component: MarkdownViewerEditable,
    propsSchema: markdownViewerEditableSchema,
  },
];

export const tamboTools: TamboTool[] = [
  {
    name: "get_document_contents",
    description: "Get the contents of a document",
    tool: async (input: string) => {
      return docContents;
    },
    toolSchema: z.function().args(z.string()).returns(z.string()),
  },
];
