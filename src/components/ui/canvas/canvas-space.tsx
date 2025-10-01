/**
 * CanvasSpace Component
 *
 * This is the main canvas component that displays the Tldraw canvas and handles
 * the creation and management of custom shapes.
 *
 * DEVELOPER NOTES:
 * - Uses TldrawWithPersistence for persistent canvas state
 * - Handles custom shape creation and updates
 * - Manages message-to-shape mapping for persistent rendering
 * - Handles component addition and deletion
 * - Implements debounced component addition for performance
 * - Manages component state with optimistic updates
 * - Handles custom 'custom:showComponent' events
 * - Manages component store for persistent rendering
 * - Handles thread state changes and resets
 *
 * FEATURES:
 * - Dynamic masonry layout for responsive rendering
 * - Drag-and-drop functionality for component reordering
 * - Persistent rendering of components across thread state changes
 * - Optimized component addition with debouncing
 * - Toast notifications for UI feedback
 *
 * DEPENDENCIES:
 * - @/hooks/use-auth: Authentication state
 * - tldraw: Canvas editor
 * - react-hot-toast: Toast notifications
 * - nanoid: Unique ID generation
 *
 * STYLING:
 * - Uses Tailwind CSS for styling
 * - Implements responsive design with flexbox
 * - Uses gradient background for modern aesthetic
 * - Handles overflow with relative positioning
 */

'use client';

import { cn, createLogger } from '@/lib/utils';
import { useRef, useState } from 'react';
import { usecustom } from '@custom-ai/react';
import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Editor } from 'tldraw';
import { Toaster } from 'react-hot-toast';

import { CanvasLiveKitContext } from './livekit/livekit-room-connector';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '../../lib/livekit/livekit-bus';
import {
  useCanvasComponentStore,
  useCanvasRehydration,
  useCanvasThreadReset,
  useCanvasEvents,
  useCanvasInteractions,
  useCanvasMessageSync,
} from './hooks';

// Dynamic imports for heavy tldraw components - only load when needed

const TldrawWithCollaboration = dynamic(
  () =>
    import('./tldraw-with-collaboration').then((mod) => ({
      default: mod.TldrawWithCollaboration,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full w-full">Loading canvas...</div>
    ),
  },
);

// Import types statically (they don't add to bundle size)
import { customShapeUtil, ToolboxShapeUtil, MermaidStreamShapeUtil } from './tldraw-canvas';

// Suppress development noise and repetitive warnings
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn;
  const originalLog = console.log;
  let mcpLoadingCount = 0;

  console.warn = (...args) => {
    const message = args.join(' ');
    // Filter out tldraw multiple instances warnings
    if (
      message.includes('You have multiple instances of some tldraw libraries active') ||
      message.includes('This can lead to bugs and unexpected behavior') ||
      message.includes('This usually means that your bundler is misconfigured')
    ) {
      return; // Skip these warnings
    }
    originalWarn.apply(console, args);
  };

  console.log = (...args) => {
    const message = args.join(' ');
    // Filter out repetitive MCP loading messages after first few
    if (message.includes('[MCP] Loading 4 MCP server(s)')) {
      mcpLoadingCount++;
      if (mcpLoadingCount > 3) {
        return; // Skip after showing 3 times
      }
    }
    originalLog.apply(console, args);
  };
}

/**
 * Props for the CanvasSpace component
 * @interface
 */
interface CanvasSpaceProps {
  /** Optional CSS class name for custom styling */
  className?: string;
  /** Optional callback to toggle transcript panel */
  onTranscriptToggle?: () => void;
}

/**
 * A canvas space component that displays multiple persistent rendered components
 * from chat messages with dynamic masonry layout and drag-and-drop functionality.
 * @component
 * @example
 * ```tsx
 * <CanvasSpace className="custom-styles" />
 * ```
 */
export function CanvasSpace({ className, onTranscriptToggle }: CanvasSpaceProps) {
  // TODO: Access the current context
  const { thread } = usecustom();
  const [editor, setEditor] = useState<Editor | null>(null);
  const previousThreadId = useRef<string | null>(null);
  const livekitCtx = React.useContext(CanvasLiveKitContext);
  const room = useRoomContext();
  const bus = createLiveKitBus(room);
  const logger = createLogger('CanvasSpace');

  const {
    componentStore,
    setMessageIdToShapeIdMap,
    addedMessageIds,
    setAddedMessageIds,
    addComponentToCanvas,
    queuePendingComponent,
    drainPendingComponents,
  } = useCanvasComponentStore(editor, logger);

  useCanvasRehydration({
    editor,
    componentStore,
    setMessageIdToShapeIdMap,
    setAddedMessageIds,
    logger,
  });

  useCanvasThreadReset({
    thread,
    editor,
    componentStore,
    setMessageIdToShapeIdMap,
    setAddedMessageIds,
    previousThreadId,
    logger,
  });

  useCanvasEvents({
    editor,
    addComponentToCanvas,
    queuePendingComponent,
    drainPendingComponents,
    bus,
    logger,
  });

  const { toggleComponentToolbox, showOnboarding, handleDragOver, handleDrop } =
    useCanvasInteractions({
      editor,
      componentStore,
      logger,
    });

  useCanvasMessageSync({
    editor,
    thread,
    addedMessageIds,
    addComponentToCanvas,
    logger,
  });

  // Provide shape utils synchronously at first render so the store registers them on mount
  const customShapeUtils = React.useMemo(() => {
    return [customShapeUtil, ToolboxShapeUtil, MermaidStreamShapeUtil] as any[];
  }, []);

  // Export functionality is now handled by TldrawWithPersistence component

  return (
    <div
      className={cn(
        'h-screen flex-1 flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 overflow-hidden relative',
        className,
      )}
      data-canvas-space="true"
    >
      {/* Toast notifications */}
      <Toaster position="bottom-left" />

      {/* Use tldraw with collaboration for sync support */}
      <div className="absolute inset-0 z-0" onDragOver={handleDragOver} onDrop={handleDrop}>
        <TldrawWithCollaboration
          key={livekitCtx?.roomName || 'no-room'}
          onMount={setEditor}
          shapeUtils={customShapeUtils as any}
          componentStore={componentStore.current}
          className="absolute inset-0"
          onTranscriptToggle={onTranscriptToggle}
          onHelpClick={showOnboarding}
          onComponentToolboxToggle={toggleComponentToolbox}
          readOnly={false}
        />
      </div>

      {/* Component Toolbox is now rendered as a shape on canvas, not as a floating panel */}
      {/*
        The following is a placeholder for if you want to show some UI when the editor is not loaded
        or if there are no components. For now, Tldraw handles its own empty state.
      */}
      {!editor && (
        <div className="flex-1 flex items-center justify-center text-center p-8 h-full">
          <div className="space-y-6 max-w-md">
            <div className="text-8xl mb-6 animate-pulse">🎨</div>
            <div className="space-y-3">
              <p className="text-gray-700 font-semibold text-xl">Loading Canvas...</p>
              <p className="text-gray-500 text-base leading-relaxed">
                The canvas is initializing. Please wait a moment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
