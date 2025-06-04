"use client";

import { Tldraw, TLUiOverrides, DefaultToolbar, DefaultToolbarContent, TldrawUiMenuItem, useEditor, TLComponents } from 'tldraw';
import { ReactNode, useRef, useEffect, createContext, useState, useCallback } from 'react';
import { Save, Download, FolderOpen } from 'lucide-react';
import Link from 'next/link';
import { useCanvasPersistence } from '@/hooks/use-canvas-persistence';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'react-hot-toast';
import { TamboShapeUtil, ComponentStoreContext } from './tldraw-canvas';
import type { Editor } from 'tldraw';

interface TldrawWithPersistenceProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
}

// Custom toolbar component that includes persistence controls
function CustomToolbar() {
  const editor = useEditor();
  const { user } = useAuth();
  const { 
    canvasName, 
    isSaving, 
    lastSaved, 
    saveCanvas, 
    updateCanvasName 
  } = useCanvasPersistence(editor);

  const handleExport = useCallback(async () => {
    if (!editor) return;
    
    try {
      const svg = await editor.getSvg(editor.getCurrentPageShapeIds());
      if (svg) {
        const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${canvasName}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Canvas exported!');
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed');
    }
  }, [editor, canvasName]);

  if (!user) {
    return <DefaultToolbar><DefaultToolbarContent /></DefaultToolbar>;
  }

  return (
    <DefaultToolbar>
      {/* Canvas persistence controls at the beginning */}
      <div className="flex items-center gap-2 px-2 border-r border-gray-200 mr-2">
        {/* Canvas Name Input */}
        <input
          type="text"
          value={canvasName}
          onChange={(e) => updateCanvasName(e.target.value)}
          className="px-2 py-1 text-sm bg-transparent border border-gray-300 rounded focus:outline-none focus:border-blue-400 min-w-[120px] max-w-[180px]"
          placeholder="Canvas name..."
          title="Canvas name"
        />
        
        {/* Save Button */}
        <button
          onClick={saveCanvas}
          disabled={isSaving}
          className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
          title="Save canvas"
        >
          <Save className="w-3 h-3" />
          {isSaving ? "Saving..." : "Save"}
        </button>

        {/* Export Button */}
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Export as SVG"
        >
          <Download className="w-3 h-3" />
          Export
        </button>

        {/* My Canvases Link */}
        <Link 
          href="/canvases"
          className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="My Canvases"
        >
          <FolderOpen className="w-3 h-3" />
          My Canvases
        </Link>

        {/* Last Saved Indicator */}
        {lastSaved && (
          <span className="text-xs text-gray-500" title={`Last saved: ${lastSaved.toLocaleString()}`}>
            {lastSaved.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Default tldraw toolbar content */}
      <DefaultToolbarContent />
    </DefaultToolbar>
  );
}

// Simplified overrides to avoid potential API issues
const persistenceOverrides: TLUiOverrides = {};

// Custom components with persistence toolbar only (simplify for now)
const persistenceComponents: TLComponents = {
  Toolbar: CustomToolbar,
};

export function TldrawWithPersistence({ 
  onMount, 
  shapeUtils, 
  componentStore, 
  className 
}: TldrawWithPersistenceProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback((mountedEditor: Editor) => {
    setEditor(mountedEditor);
    onMount?.(mountedEditor);
  }, [onMount]);

  return (
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          onMount={handleMount}
          shapeUtils={shapeUtils || []}
          components={persistenceComponents}
          overrides={persistenceOverrides}
        />
      </ComponentStoreContext.Provider>
    </div>
  );
} 