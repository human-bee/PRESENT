'use client';

import { useCallback } from 'react';
import { useFairyContextBundle, type FairyContextBundle } from '@/lib/fairy-context/use-fairy-context-bundle';

type PromptDataOptions = {
  metadata?: unknown;
  selectionIds?: string[];
  profile?: string;
  spectrum?: number;
};

export function useFairyPromptData() {
  const buildContextBundle = useFairyContextBundle();

  return useCallback(
    (options: PromptDataOptions = {}): FairyContextBundle => {
      const bundle = buildContextBundle({
        selectionIds: options.selectionIds ?? [],
        metadata: options.metadata,
        profile: options.profile,
        spectrum: options.spectrum,
      });

      return bundle;
    },
    [buildContextBundle],
  );
}
