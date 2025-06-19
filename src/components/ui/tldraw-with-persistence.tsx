"use client";

import { Tldraw, TLUiOverrides, DefaultToolbar, DefaultToolbarContent, TldrawUiMenuItem, useEditor, TLComponents, DefaultMainMenu, DefaultMainMenuContent, TldrawUiMenuGroup } from 'tldraw';
import { ReactNode, createContext, useState, useCallback } from 'react';
import { User } from 'lucide-react';
import { useCanvasPersistence } from '@/hooks/use-canvas-persistence';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'react-hot-toast';
import { TamboShapeUtil, ComponentStoreContext } from './tldraw-canvas';
import type { Editor } from 'tldraw';
import { useRouter } from 'next/navigation';
import * as React from 'react';

interface TldrawWithPersistenceProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
}

// Create a context for transcript panel state
export const TranscriptPanelContext = createContext<{
  isOpen: boolean;
  toggle: () => void;
}>({
  isOpen: false,
  toggle: () => {},
});

// Simplified overrides to avoid potential API issues
const createPersistenceOverrides = (): TLUiOverrides => ({
  // Empty overrides for now - transcript button will be outside toolbar
});

// Custom main menu component that includes user navigation
function CustomMainMenu() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const editor = useEditor();
  const { 
    canvasName, 
    isSaving, 
    lastSaved, 
    saveCanvas, 
    updateCanvasName 
  } = useCanvasPersistence(editor);

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/auth/signin");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleOpenCanvases = () => {
    router.push("/canvases");
  };

  const handleMcpConfig = () => {
    // Navigate to MCP config page
    router.push("/mcp-config");
  };

  const handleExport = async () => {
    if (!editor) return;
    
    try {
      const svg = await editor.getSvg(Array.from(editor.getCurrentPageShapeIds()));
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
  };

  const handleRenameCanvas = () => {
    const newName = window.prompt("Enter canvas name:", canvasName || "Untitled Canvas");
    if (newName !== null && newName.trim()) {
      updateCanvasName(newName.trim());
    }
  };

  return (
    <DefaultMainMenu>
      <DefaultMainMenuContent />
      
      {/* Canvas persistence group */}
      <TldrawUiMenuGroup id="canvas-persistence">
        {/* Canvas info - shows name and last saved */}
        <div style={{ 
          padding: '4px 12px', 
          fontSize: '12px',
          color: 'var(--color-text-1)'
        }}>
          <div style={{ fontWeight: 500 }}>{canvasName || "Untitled Canvas"}</div>
          {lastSaved && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-3)', marginTop: '2px' }}>
              Saved {lastSaved.toLocaleTimeString()}
            </div>
          )}
        </div>
        
        <TldrawUiMenuItem
          id="rename-canvas"
          label="Rename Canvas"
          icon="text"
          onSelect={handleRenameCanvas}
        />
        
        <TldrawUiMenuItem
          id="save-canvas"
          label={isSaving ? "Saving..." : "Save Canvas"}
          icon="save"
          disabled={isSaving}
          onSelect={saveCanvas}
        />
        
        <TldrawUiMenuItem
          id="export-canvas"
          label="Export as SVG"
          icon="external-link"
          onSelect={handleExport}
        />
      </TldrawUiMenuGroup>
      
      {/* Add separator before our custom items */}
      <TldrawUiMenuGroup id="user-navigation">
        <TldrawUiMenuItem
          id="my-canvases"
          label="My Canvases"
          icon="external-link"
          onSelect={handleOpenCanvases}
        />
        
        <TldrawUiMenuItem
          id="mcp-config"
          label="MCP Configuration"
          icon="settings-horizontal"
          onSelect={handleMcpConfig}
        />
        
        {/* Separator */}
        <div style={{ height: 1, backgroundColor: 'var(--color-divider)', margin: '4px 0' }} />
        
        {/* User info - non-clickable */}
        <div style={{ 
          padding: '0 12px', 
          height: '32px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          color: 'var(--color-text-1)',
          fontSize: '12px'
        }}>
          <User size={14} />
          <span>{user?.user_metadata?.full_name || user?.email || 'User'}</span>
        </div>
        
        <TldrawUiMenuItem
          id="sign-out"
          label="Sign out"
          icon="external-link"
          onSelect={handleSignOut}
        />
      </TldrawUiMenuGroup>
    </DefaultMainMenu>
  );
}

// Custom toolbar with transcript button
function CustomToolbarWithTranscript({ onTranscriptToggle }: { onTranscriptToggle?: () => void }) {
  const { user } = useAuth();

  if (!user) {
    return <DefaultToolbar><DefaultToolbarContent /></DefaultToolbar>;
  }

  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
  const shortcutText = isMac ? "⌘K" : "Ctrl+K";

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      {onTranscriptToggle && (
        <div className="tlui-toolbar__tools">
          <button
            className="tlui-button tlui-button__tool"
            onClick={onTranscriptToggle}
            title={`Transcript (${shortcutText})`}
            style={{
              color: 'rgb(29, 29, 29)',
            }}
          >
            <div 
              className="tlui-icon tlui-button__icon"
              style={{
                mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z'%3E%3C/path%3E%3Cpath d='M19 10v2a7 7 0 0 1-14 0v-2'%3E%3C/path%3E%3Cline x1='12' y1='19' x2='12' y2='22'%3E%3C/line%3E%3C/svg%3E") center 100% / 100% no-repeat`
              }}
            />
          </button>
        </div>
      )}
    </DefaultToolbar>
  );
}

// Custom components with persistence toolbar only (simplify for now)
const createPersistenceComponents = (onTranscriptToggle?: () => void): TLComponents => ({
  Toolbar: (props) => <CustomToolbarWithTranscript {...props} onTranscriptToggle={onTranscriptToggle} />,
  MainMenu: CustomMainMenu,
});

export function TldrawWithPersistence({ 
  onMount, 
  shapeUtils, 
  componentStore, 
  className,
  onTranscriptToggle
}: TldrawWithPersistenceProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback((mountedEditor: Editor) => {
    setEditor(mountedEditor);
    onMount?.(mountedEditor);
  }, [onMount]);

  // Create the overrides with the transcript toggle function
  const overrides = React.useMemo(
    () => createPersistenceOverrides(),
    []
  );

  // Handle keyboard shortcut for transcript
  React.useEffect(() => {
    if (!onTranscriptToggle) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        onTranscriptToggle();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onTranscriptToggle]);

  return (
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          onMount={handleMount}
          shapeUtils={shapeUtils || []}
          components={createPersistenceComponents(onTranscriptToggle)}
          overrides={overrides}
          forceMobile={true}
        />
      </ComponentStoreContext.Provider>
    </div>
  );
}