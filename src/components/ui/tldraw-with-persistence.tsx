'use client';

import {
  Tldraw,
  TLUiOverrides,
  DefaultToolbar,
  DefaultToolbarContent,
  TldrawUiMenuItem,
  useEditor,
  TLComponents,
  DefaultMainMenu,
  DefaultMainMenuContent,
  TldrawUiMenuGroup,
} from 'tldraw';
import { ReactNode, createContext, useState, useCallback, useEffect } from 'react';
import { User } from 'lucide-react';
import { useCanvasPersistence } from '@/hooks/use-canvas-persistence';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'react-hot-toast';
import { customShapeUtil, ComponentStoreContext } from './tldraw-canvas';
import type { customShape } from './tldraw-canvas';
import type { Editor } from 'tldraw';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import TldrawSnapshotBroadcaster from '@/components/TldrawSnapshotBroadcaster';

interface TldrawWithPersistenceProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof customShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
}

// Create a context for transcript panel state
export const TranscriptPanelContext = createContext<{
  isOpen: boolean;
  toggle: () => void;
}>({
  isOpen: false,
  toggle: () => { },
});

const createPersistenceOverrides = (): TLUiOverrides => {
  return {
    contextMenu: (_editor, contextMenu, { onlySelectedShape }) => {
      if (onlySelectedShape && onlySelectedShape.type === 'custom') {
        const isPinned = (onlySelectedShape as customShape).props.pinned ?? false;

        const pinItem = {
          id: 'pin-to-viewport',
          type: 'item' as const,
          label: isPinned ? 'Unpin from Window' : 'Pin to Window',
          onSelect: () => {
            const editor = _editor;
            const shape = onlySelectedShape as customShape;

            if (!isPinned) {
              // Calculate relative position when pinning
              const viewport = editor.getViewportScreenBounds();
              const bounds = editor.getShapePageBounds(shape.id);
              if (bounds) {
                // Convert page bounds to screen coordinates
                const screenPoint = editor.pageToScreen({
                  x: bounds.x + bounds.w / 2,
                  y: bounds.y + bounds.h / 2,
                });
                const pinnedX = screenPoint.x / viewport.width;
                const pinnedY = screenPoint.y / viewport.height;

                editor.updateShapes([
                  {
                    id: shape.id,
                    type: 'custom',
                    props: {
                      pinned: true,
                      pinnedX: Math.max(0, Math.min(1, pinnedX)),
                      pinnedY: Math.max(0, Math.min(1, pinnedY)),
                    },
                  },
                ]);
              }
            } else {
              // Unpin the shape
              editor.updateShapes([
                {
                  id: shape.id,
                  type: 'custom',
                  props: {
                    pinned: false,
                  },
                },
              ]);
            }
          },
        };

        // Add separator and pin item at the end
        contextMenu.push({ type: 'separator' as const });
        contextMenu.push(pinItem);
      }

      return contextMenu;
    },
  };
};

function CustomMainMenu({ readOnly = false }: { readOnly?: boolean } & any) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const editor = useEditor();
  const { canvasName, isSaving, lastSaved, saveCanvas, updateCanvasName } = useCanvasPersistence(
    editor,
    !readOnly,
  );

  // Helper to disable or no-op in read-only mode
  const disabled = readOnly;

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/auth/signin');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleOpenCanvases = () => {
    router.push('/canvases');
  };

  const handleMcpConfig = () => {
    // Navigate to MCP config page
    router.push('/mcp-config');
  };

  const handleExport = async () => {
    if (!editor) return;
    if (disabled) return;

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
    if (disabled) return;
    const newName = window.prompt('Enter canvas name:', canvasName || 'Untitled Canvas');
    if (newName !== null && newName.trim()) {
      updateCanvasName(newName.trim());
    }
  };

  const handleSaveCanvas = () => {
    if (disabled) return;
    saveCanvas();
  };

  return (
    <DefaultMainMenu>
      <DefaultMainMenuContent />

      {/* Canvas persistence group */}
      <TldrawUiMenuGroup id="canvas-persistence">
        {/* Canvas info - shows name and last saved */}
        <div
          style={{
            padding: '4px 12px',
            fontSize: '12px',
            color: 'var(--color-text-1)',
          }}
        >
          <div style={{ fontWeight: 500 }}>{canvasName || 'Untitled Canvas'}</div>
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
          disabled={disabled}
          onSelect={handleRenameCanvas}
        />

        <TldrawUiMenuItem
          id="save-canvas"
          label={isSaving ? 'Saving...' : 'Save Canvas'}
          icon="save"
          disabled={disabled || isSaving}
          onSelect={handleSaveCanvas}
        />

        <TldrawUiMenuItem
          id="export-canvas"
          label="Export as SVG"
          icon="external-link"
          disabled={disabled}
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
        <div
          style={{
            padding: '0 12px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--color-text-1)',
            fontSize: '12px',
          }}
        >
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

// Custom toolbar with transcript, help, and component toolbox buttons
function CustomToolbarWithTranscript({
  onTranscriptToggle,
  onHelpClick,
  onComponentToolboxToggle,
}: {
  onTranscriptToggle?: () => void;
  onHelpClick?: () => void;
  onComponentToolboxToggle?: () => void;
}) {
  const { user } = useAuth();

  if (!user) {
    return (
      <DefaultToolbar>
        <DefaultToolbarContent />
      </DefaultToolbar>
    );
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');
  const shortcutText = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      <div className="tlui-toolbar__tools">
        {/* Component Toolbox button */}
        {onComponentToolboxToggle && (
          <button
            className="tlui-button tlui-button__tool"
            onClick={onComponentToolboxToggle}
            title="Component Toolbox - Browse and add components"
            style={{
              color: 'rgb(29, 29, 29)',
            }}
          >
            <div
              className="tlui-icon tlui-button__icon"
              style={{
                mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='13.5' cy='6.5' r='.5'%3E%3C/circle%3E%3Ccircle cx='17.5' cy='10.5' r='.5'%3E%3C/circle%3E%3Ccircle cx='8.5' cy='7.5' r='.5'%3E%3C/circle%3E%3Ccircle cx='6.5' cy='12.5' r='.5'%3E%3C/circle%3E%3Cpath d='M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z'%3E%3C/path%3E%3C/svg%3E") center 100% / 100% no-repeat`,
              }}
            />
          </button>
        )}

        {/* Transcript button */}
        {onTranscriptToggle && (
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
                mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z'%3E%3C/path%3E%3Cpath d='M19 10v2a7 7 0 0 1-14 0v-2'%3E%3C/path%3E%3Cline x1='12' y1='19' x2='12' y2='22'%3E%3C/line%3E%3C/svg%3E") center 100% / 100% no-repeat`,
              }}
            />
          </button>
        )}

        {/* Help button */}
        {onHelpClick && (
          <button
            className="tlui-button tlui-button__tool"
            onClick={onHelpClick}
            title="Show help and onboarding"
            style={{
              color: 'rgb(29, 29, 29)',
            }}
          >
            <div
              className="tlui-icon tlui-button__icon"
              style={{
                mask: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpath d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'%3E%3C/path%3E%3Cpath d='M12 17h.01'%3E%3C/path%3E%3C/svg%3E") center 100% / 100% no-repeat`,
              }}
            />
          </button>
        )}
      </div>
    </DefaultToolbar>
  );
}

// Custom components with persistence toolbar only (simplify for now)
const createPersistenceComponents = (
  onTranscriptToggle?: () => void,
  onHelpClick?: () => void,
  onComponentToolboxToggle?: () => void,
): TLComponents => ({
  Toolbar: (props) => (
    <CustomToolbarWithTranscript
      {...props}
      onTranscriptToggle={onTranscriptToggle}
      onHelpClick={onHelpClick}
      onComponentToolboxToggle={onComponentToolboxToggle}
    />
  ),
  MainMenu: CustomMainMenu,
});

export function TldrawWithPersistence({
  onMount,
  shapeUtils,
  componentStore,
  className,
  onTranscriptToggle,
  onHelpClick,
  onComponentToolboxToggle,
}: TldrawWithPersistenceProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      setEditor(mountedEditor);
      // Expose editor globally and emit event for listeners
      if (typeof window !== 'undefined') {
        (window as any).__present = (window as any).__present || {};
        (window as any).__present.tldrawEditor = mountedEditor;
        try {
          window.dispatchEvent(
            new CustomEvent('present:editor-mounted', { detail: { editor: mountedEditor } }),
          );
        } catch { }
      }
      onMount?.(mountedEditor);
    },
    [onMount],
  );

  // Render a lightweight placeholder until the TLDraw editor instance is ready.
  const isEditorReady = Boolean(editor);

  // Create the overrides with the transcript toggle function
  const overrides = React.useMemo(() => createPersistenceOverrides(), []);

  // Handle keyboard shortcut for transcript
  React.useEffect(() => {
    if (!onTranscriptToggle) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        onTranscriptToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onTranscriptToggle]);

  return (
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      {/* Always render Tldraw so that onMount fires and the editor becomes ready */}
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          onMount={handleMount}
          shapeUtils={shapeUtils || []}
          components={createPersistenceComponents(
            onTranscriptToggle,
            onHelpClick,
            onComponentToolboxToggle,
          )}
          overrides={overrides}
          forceMobile={true}
        />
        <TldrawSnapshotBroadcaster />
      </ComponentStoreContext.Provider>

      {/* Overlay a simple loading state until the editor instance is available */}
      {!isEditorReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 pointer-events-none select-none">
          <div className="text-gray-500">Loading canvas...</div>
        </div>
      )}
    </div>
  );
}

export { CustomMainMenu, CustomToolbarWithTranscript, createPersistenceComponents };
