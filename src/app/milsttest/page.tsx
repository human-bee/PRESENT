"use client";
import { MessageThreadFull } from "@/components/ui/message-thread-full";
import { TamboProvider } from "@tambo-ai/react";
import { CurrentComponentSpace } from "./current-component-space";
import { testComponents } from "./test-tambo-setup";

export default function MilstTest() {
  return (
    <div className="h-screen flex flex-col overflow-hidden max-w-full mx-auto">
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={testComponents}
        // tools={tools}
        tamboUrl={process.env.NEXT_PUBLIC_TAMBO_URL}
      >
        <div className="flex h-full">
          {/* Message Thread on the left */}
          <div className="w-2/3 border-r">
            <MessageThreadFull contextKey="tambo-template" />
          </div>

          {/* Current Component Space on the right */}
          <div className="w-1/3 p-4">
            <CurrentComponentSpace />
          </div>
        </div>
      </TamboProvider>
    </div>
  );
}
