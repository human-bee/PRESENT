"use client";

import { useCallback } from 'react';
import type { Editor, TLImageExportOptions } from '@tldraw/tldraw';
import { createDefaultFilename, ensureFileExtension, normalizeIds, type ExportFormat } from '../utils';

interface ExportImportOptions {
  defaultFilename?: string;
}

export function useExportImport(editor: Editor | null, options: ExportImportOptions = {}) {
  const { defaultFilename = 'present-canvas' } = options;

  const exportAs = useCallback(
    async (format: ExportFormat, ids?: string[], exportOptions?: TLImageExportOptions) => {
      if (!editor) return;
      const unsafeEditor = editor as any;
      const targetIds = normalizeIds(ids as any);
      const filename = createDefaultFilename(defaultFilename, format);

      switch (format) {
        case 'json': {
          const content = unsafeEditor.getJson?.(targetIds);
          if (!content) return;
          triggerDownload(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }), filename);
          break;
        }
        case 'svg': {
          const result = await unsafeEditor.getSvgString?.(targetIds, exportOptions);
          if (!result?.svg) return;
          triggerDownload(new Blob([result.svg], { type: 'image/svg+xml' }), filename);
          break;
        }
        case 'png': {
          const blob = await unsafeEditor.toImage?.(targetIds, { format: 'png', ...exportOptions });
          if (!blob?.blob) return;
          triggerDownload(blob.blob, ensureFileExtension(filename, 'png'));
          break;
        }
        default:
          break;
      }
    },
    [defaultFilename, editor],
  );

  const importJson = useCallback(
    async (file: File) => {
      if (!editor) return;
      const text = await file.text();
      const content = JSON.parse(text);
      const unsafeEditor = editor as any;
      unsafeEditor.putContentOntoCurrentPage?.(content, { select: true });
    },
    [editor],
  );

  return {
    exportAs,
    importJson,
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
