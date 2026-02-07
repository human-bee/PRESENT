'use client';

import {
  Tldraw,
  DefaultToolbar,
  DefaultToolbarContent,
  TldrawUiMenuItem,
  useEditor,
  TLComponents,
  DefaultMainMenu,
  DefaultMainMenuContent,
  TldrawUiMenuGroup,
  DefaultContextMenu,
  DefaultContextMenuContent,
  TLUiContextMenuProps,
  useValue,
} from '@tldraw/tldraw';
import { ReactNode, createContext, useState, useCallback, useEffect } from 'react';
import { User, Edit2 } from 'lucide-react';
import { useCanvasPersistence } from '@/hooks/use-canvas-persistence';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'react-hot-toast';
import { customShapeUtil, ComponentStoreContext } from './tldraw-canvas';
import type { customShape } from './tldraw-canvas';
import type { Editor } from '@tldraw/tldraw';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { logJourneyEvent } from '@/lib/journey-logger';

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
  setIsOpen: (isOpen: boolean) => void;
}>({
  isOpen: false,
  setIsOpen: () => {},
});

function CustomMainMenu({ readOnly = false }: { readOnly?: boolean } & any) {
  const { saveCanvas, lastSaved, isSaving, canvasName, renameCanvas } = useCanvasPersistence(null);
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  // Initialize display name from local storage or auth
  useEffect(() => {
    const storedName = window.localStorage.getItem('present:display_name');
    const authName = user?.user_metadata?.full_name || user?.email;
    setDisplayName(storedName || authName || 'User');
  }, [user]);

  const handleSaveName = () => {
    setIsEditingName(false);
    if (displayName.trim()) {
      window.localStorage.setItem('present:display_name', displayName.trim());
      // Force a reload to pick up the new name for LiveKit connection
      // In a more complex app we'd update the context, but this ensures a clean state
      window.location.reload(); 
    }
  };

  const handleRenameCanvas = () => {
    const newName = prompt('Enter a new name for your canvas:', canvasName);
    if (newName) {
      renameCanvas(newName);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/auth/signin');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    }
  };

  const handleNewCanvas = () => {
    router.push('/canvas?fresh=1');
  };

  const handleOpenCanvases = () => {
    router.push('/canvases');
  };

  const handleMcpConfig = () => {
    router.push('/mcp-config');
  };

  const handleExport = () => {
    // The export functionality is handled by the default menu item,
    // we just wrapping it to ensure it's exposed
    const event = new KeyboardEvent('keydown', {
      key: 'e',
      code: 'KeyE',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const disabled = readOnly;

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
          id="new-canvas"
          label="New Canvas"
          icon="external-link"
          onSelect={handleNewCanvas}
        />

        <TldrawUiMenuItem
          id="mcp-config"
          label="MCP Configuration"
          icon="settings-horizontal"
          onSelect={handleMcpConfig}
        />

        {/* Separator */}
        <div style={{ height: 1, backgroundColor: 'var(--color-divider)', margin: '4px 0' }} />

        {/* User info - Click to edit */}
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
          {isEditingName ? (
            <input
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              style={{
                border: '1px solid var(--color-primary)',
                borderRadius: '4px',
                padding: '2px 4px',
                fontSize: '12px',
                width: '100%',
                outline: 'none',
              }}
            />
          ) : (
            <div 
              className="flex items-center gap-2 cursor-pointer hover:text-blue-600 w-full"
              onClick={() => setIsEditingName(true)}
              title="Click to change display name"
            >
              <span className="font-medium truncate max-w-[120px]">{displayName}</span>
              <Edit2 size={10} className="opacity-50" />
            </div>
          )}
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
  const { isOpen } = React.useContext(TranscriptPanelContext);

  const handleShare = useCallback(async () => {
    if (typeof window === 'undefined') return;

    const id =
      new URL(window.location.href).searchParams.get('id') ||
      window.localStorage.getItem('present:lastCanvasId');
    const shareUrl = new URL('/canvas', window.location.origin);
    if (id) shareUrl.searchParams.set('id', id);
    shareUrl.searchParams.set('share', '1');
    const shareLink = shareUrl.toString();

    logJourneyEvent({
      eventType: 'share_clicked',
      source: 'ui',
      payload: {
        method: typeof navigator.share === 'function' ? 'share_sheet' : 'clipboard',
        shareUrl: shareLink,
        canvasId: id || null,
      },
    });

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Present Canvas',
          text: 'Join my canvas',
          url: shareLink,
        });
        toast.success('Share sheet opened');
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(shareLink);
      toast.success('Link copied');
    } catch {
      toast.error('Failed to copy link');
    }
  }, []);

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      <TldrawUiMenuItem
        id="component-toolbox"
        label="Component Toolbox"
        icon="plus"
        onSelect={onComponentToolboxToggle}
      />
      <TldrawUiMenuItem
        id="share-canvas"
        label="Share"
        icon="external-link"
        onSelect={handleShare}
      />
      <TldrawUiMenuItem
        id="transcript-toggle"
        label={isOpen ? 'Hide Transcript' : 'Show Transcript'}
        icon="blob"
        onSelect={onTranscriptToggle}
        isSelected={isOpen}
      />
      <TldrawUiMenuItem
        id="help-toggle"
        label="Help"
        icon="question-mark"
        onSelect={onHelpClick}
      />
    </DefaultToolbar>
  );
}

export { CustomMainMenu, CustomToolbarWithTranscript };
