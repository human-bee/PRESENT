import * as React from 'react';
import { Bot, User, Volume2 } from 'lucide-react';

type ParticipantMinimizedViewProps = {
  visible: boolean;
  isAgent: boolean;
  displayName: string;
  isSpeaking: boolean;
};

export function ParticipantMinimizedView({ visible, isAgent, displayName, isSpeaking }: ParticipantMinimizedViewProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 bg-gray-800 flex items-center px-3">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isAgent ? (
          <Bot className="w-4 h-4 text-blue-400 flex-shrink-0" />
        ) : (
          <User className="w-4 h-4 text-white flex-shrink-0" />
        )}
        <span className="text-white text-sm font-medium truncate">{displayName}</span>
        {isSpeaking && <Volume2 className="w-3 h-3 text-green-400 animate-pulse flex-shrink-0" />}
      </div>
    </div>
  );
}
