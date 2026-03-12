'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FAIRY_CANVAS_MODEL_OPTIONS,
  FAIRY_CANVAS_MODEL_STORAGE_KEY,
  getFairyCanvasModelOption,
  normalizeFairyCanvasModelId,
  readStoredFairyCanvasModel,
  writeStoredFairyCanvasModel,
  type FairyCanvasModelId,
} from '@/lib/fairy-canvas-model-selection';

export function useFairyCanvasModelSelection() {
  const [selectedModel, setSelectedModelState] = useState<FairyCanvasModelId | null>(null);

  useEffect(() => {
    setSelectedModelState(readStoredFairyCanvasModel());

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FAIRY_CANVAS_MODEL_STORAGE_KEY) return;
      setSelectedModelState(readStoredFairyCanvasModel());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return useMemo(
    () => ({
      options: FAIRY_CANVAS_MODEL_OPTIONS,
      selectedModel,
      selectedOption: getFairyCanvasModelOption(selectedModel),
      setSelectedModel: (nextValue: FairyCanvasModelId | null) => {
        const normalized = writeStoredFairyCanvasModel(normalizeFairyCanvasModelId(nextValue));
        setSelectedModelState(normalized);
      },
    }),
    [selectedModel],
  );
}
