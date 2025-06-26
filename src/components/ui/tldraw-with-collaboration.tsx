"use client";

import {
  Tldraw,
  TLUiOverrides,
  TLComponents,
  Editor,
} from "tldraw";
import {
  CustomMainMenu,
  CustomToolbarWithTranscript,
} from "./tldraw-with-persistence";
import { ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSyncDemo } from "@tldraw/sync";
import { CanvasLiveKitContext } from "./livekit-room-connector";
import { ComponentStoreContext } from "./tldraw-canvas";
import type { TamboShapeUtil } from "./tldraw-canvas";

interface TldrawWithCollaborationProps {
  onMount?: (editor: Editor) => void;
  shapeUtils?: readonly (typeof TamboShapeUtil)[];
  componentStore?: Map<string, ReactNode>;
  className?: string;
  onTranscriptToggle?: () => void;
  readOnly?: boolean;
}

// Minimal overrides for now (reuse persistence overrides)
const createCollaborationOverrides = (): TLUiOverrides => ({
  // Can add custom overrides later
});

export function TldrawWithCollaboration({
  onMount,
  shapeUtils,
  componentStore,
  className,
  onTranscriptToggle,
  readOnly = false,
}: TldrawWithCollaborationProps) {
  const livekitCtx = useContext(CanvasLiveKitContext);
  const roomName = livekitCtx?.roomName ?? "default-room";

  // Store from sync demo – phase-1 implementation
  const store = useSyncDemo({
    roomId: roomName,
    readOnly,
  } as any);

  // Maintain reference to mounted editor
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback(
    (mountedEditor: Editor) => {
      setEditor(mountedEditor);
      if (onMount) onMount(mountedEditor);
    },
    [onMount]
  );

  // Create memoised overrides & components
  const overrides = useMemo(() => createCollaborationOverrides(), []);
  const components: TLComponents = useMemo(
    () => ({
      Toolbar: (props) => (
        <CustomToolbarWithTranscript
          {...props}
          onTranscriptToggle={onTranscriptToggle}
        />
      ),
      MainMenu: CustomMainMenu,
    }),
    [onTranscriptToggle]
  );

  // Keyboard shortcut for transcript
  useEffect(() => {
    if (!onTranscriptToggle) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onTranscriptToggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTranscriptToggle]);

  // Ready flag
  const isStoreReady = Boolean(store);

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      <ComponentStoreContext.Provider value={componentStore || null}>
        <Tldraw
          store={store}
          onMount={handleMount}
          shapeUtils={shapeUtils || []}
          components={components}
          overrides={overrides}
          forceMobile={true}
        />
      </ComponentStoreContext.Provider>

      {!isStoreReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 pointer-events-none select-none">
          <div className="text-gray-500">Connecting to board…</div>
        </div>
      )}
    </div>
  );
}