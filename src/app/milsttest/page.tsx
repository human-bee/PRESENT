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
    <div className="h-screen flex flex-col overflow-hidden max-w-full mx-auto">
      <TamboProvider
        apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
        components={testComponents}
        tools={tamboTools}
        tamboUrl={process.env.NEXT_PUBLIC_TAMBO_URL}
      >
        <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
          {/* Current Component Space on top */}
          <div className="flex-1 p-4 max-h-[60vh] overflow-y-auto">
            <CurrentComponentSpace />
          </div>

          {/* Message Thread on the bottom */}
          <div className="p-4 flex-shrink-0">
            <MessageInput contextKey="tambo-template">
              <MessageInputTextarea />
              <MessageInputToolbar>
                <MessageInputSubmitButton />
              </MessageInputToolbar>
              <MessageInputError />
            </MessageInput>
          </div>
        </div>
      </TamboProvider>
    </div>
  );
}
