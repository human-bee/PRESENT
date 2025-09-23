import * as React from 'react';
import { Bot, Crown } from 'lucide-react';

type ParticipantNameOverlayProps = {
  visible: boolean;
  isAgent: boolean;
  isLocal: boolean;
  displayName: string;
};

export function ParticipantNameOverlay({ visible, isAgent, isLocal, displayName }: ParticipantNameOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
      <div className="bg-black/60 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5">
        {isAgent && <Bot className="w-3.5 h-3.5 text-blue-400" />}
        {isLocal && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
        <span className="text-white text-xs font-medium truncate max-w-[120px]">{displayName}</span>
      </div>
    </div>
  );
}
