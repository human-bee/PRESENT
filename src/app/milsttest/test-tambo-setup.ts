import {
  MarkdownViewer,
  markdownViewerSchema,
} from "@/components/ui/markdown-viewer";
import { TamboComponent } from "@tambo-ai/react";

export const testComponents: TamboComponent[] = [
  {
    name: "MarkdownViewer",
    description:
      "A markdown document viewer with tile preview and full-screen reading mode. Displays markdown content with PP Editorial New typography on a black background. Perfect for displaying documentation, articles, or any markdown content with an elegant reading experience.",
    component: MarkdownViewer,
    propsSchema: markdownViewerSchema,
  },
];
