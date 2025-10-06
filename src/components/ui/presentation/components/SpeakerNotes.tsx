import React from 'react';
import { FileText } from 'lucide-react';

interface SpeakerNotesProps {
  notes?: string;
}

export function SpeakerNotes({ notes }: SpeakerNotesProps) {
  if (!notes) {
    return null;
  }

  return (
    <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-300 mb-2 flex items-center">
        <FileText size={14} className="mr-2" />
        Speaker Notes
      </h4>
      <p className="text-sm text-slate-400 leading-relaxed">{notes}</p>
    </div>
  );
}
