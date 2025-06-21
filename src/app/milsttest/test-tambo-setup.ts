import { TamboComponent } from "@tambo-ai/react";
import { z } from "zod";
import { TestComponent } from "./test-component";

export const testComponents: TamboComponent[] = [
  {
    name: "TestComponent",
    description: "A text editing component with title and content",
    component: TestComponent,
    propsSchema: z.object({
      title: z.string().describe("The title of the text content"),
      content: z.string().describe("The content text to display and edit"),
    }),
  },
];
