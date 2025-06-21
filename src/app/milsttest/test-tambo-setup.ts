import { TamboComponent } from "@tambo-ai/react";
import { z } from "zod";
import { TestComponent } from "./test-component";

export const testComponents: TamboComponent[] = [
  {
    name: "TestComponent",
    description: "A test component",
    component: TestComponent,
    propsSchema: z.object({
      name: z.string(),
    }),
  },
];
