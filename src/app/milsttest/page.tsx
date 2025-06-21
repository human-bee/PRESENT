"use client";
import {
  MessageInput,
  MessageInputError,
  MessageInputSubmitButton,
  MessageInputTextarea,
  MessageInputToolbar,
} from "@/components/ui/message-input";
import { TamboProvider } from "@tambo-ai/react";
import { CurrentComponentSpace } from "./current-component-space";
import { tamboTools, testComponents } from "./test-tambo-setup";

export default function MilstTest() {
  return (
    <div className="h-screen flex overflow-hidden max-w-full mx-auto">
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={testComponents}
        tools={tamboTools}
        tamboUrl={process.env.NEXT_PUBLIC_TAMBO_URL}
      >
        <div className="flex h-full w-full">
          {/* Chat on the left */}
          <div className="w-80 flex-shrink-0 p-4 border-r border-gray-200 flex flex-col">
            <div className="flex-1 overflow-y-auto mb-4">
              {/* Message thread content would go here */}
            </div>
            <MessageInput contextKey="tambo-template">
              <MessageInputTextarea />
              <MessageInputToolbar>
                <MessageInputSubmitButton />
              </MessageInputToolbar>
              <MessageInputError />
            </MessageInput>
          </div>

          {/* Component Space on the right - takes up remaining space */}
          <div className="flex-1 p-4 overflow-y-auto max-h-screen max-w-3xl mx-auto">
            <CurrentComponentSpace />
          </div>
        </div>
      </TamboProvider>
    </div>
  );
}
