import * as React from 'react';
import { Volume2 } from 'lucide-react';

type ParticipantSpeakingIndicatorProps = {
  visible: boolean;
};

export function ParticipantSpeakingIndicator({ visible }: ParticipantSpeakingIndicatorProps) {
  if (!visible) return null;

  return (
    <div className="absolute bottom-2 left-2">
      <div className="bg-green-500/80 backdrop-blur-sm rounded-full p-1.5">
        <Volume2 className="w-3 h-3 text-white animate-pulse" />
      </div>
    </div>
  );
}
