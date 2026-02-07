import type { FairyContextProfile } from './profiles';

export type FairyContextPart = Record<string, unknown> & { type: string };

export type FairyContextSummary = {
  transcriptLines: number;
  documents: number;
  widgets: number;
  selectionIds: number;
  customShapes: number;
  profile: FairyContextProfile;
  spectrum: number;
};

export type FairyContextBundle = {
  parts: FairyContextPart[];
  summary: FairyContextSummary;
};
