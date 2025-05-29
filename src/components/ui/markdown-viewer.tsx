"use client";

import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { useEffect } from "react";
import { z } from "zod";

// Define the component props schema with Zod
export const markdownViewerSchema = z.object({
  title: z.string().describe("Title of the document"),
  content: z.string().optional().describe("Markdown content to display"),
  previewLines: z
    .number()
    .optional()
    .describe("Number of lines to show in preview (default: 3)"),
  tileHeight: z
    .string()
    .optional()
    .describe("Height of the tile in preview mode (default: '200px')"),
});

// Define the props type based on the Zod schema
export type MarkdownViewerProps = z.infer<typeof markdownViewerSchema>;

// Component state type
type MarkdownViewerState = {
  isFullScreen: boolean;
  isAnimating: boolean;
};

/**
 * MarkdownViewer Component
 *
 * A markdown viewer with preview tile and full-screen viewing capabilities.
 * Uses PP Editorial New Font Family on a black background.
 */
export function MarkdownViewer({
  title,
  content = "",
  previewLines = 3,
  tileHeight = "200px",
}: MarkdownViewerProps) {
  // Initialize Tambo component state
  const [state, setState] = useTamboComponentState<MarkdownViewerState>(
    "markdown-viewer",
    {
      isFullScreen: false,
      isAnimating: false,
    }
  );

  // Handle escape key to close full screen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state?.isFullScreen) {
        closeFullScreen();
      }
    };

    if (state?.isFullScreen) {
      document.addEventListener("keydown", handleEscape);
      // Prevent body scroll when full screen is open
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [state?.isFullScreen]);

  // Open full screen viewer
  const openFullScreen = () => {
    if (!state) return;
    setState({ ...state, isFullScreen: true, isAnimating: true });
    // Reset animation state after animation completes
    setTimeout(() => {
      if (state) {
        setState({ ...state, isFullScreen: true, isAnimating: false });
      }
    }, 300);
  };

  // Close full screen viewer
  const closeFullScreen = () => {
    if (!state) return;
    setState({ ...state, isAnimating: true });
    setTimeout(() => {
      setState({ isFullScreen: false, isAnimating: false });
    }, 300);
  };

  // Process content for preview
  const getPreviewContent = () => {
    if (!content) {
      return { preview: "", hasMore: false };
    }
    const lines = content.split("\n");
    const preview = lines.slice(0, previewLines).join("\n");
    const hasMore = lines.length > previewLines;
    return { preview, hasMore };
  };

  const { preview, hasMore } = getPreviewContent();

  // Simple markdown rendering (basic support)
  const renderMarkdown = (text: string, isPreview = false) => {
    // Handle empty or undefined text
    if (!text || text.trim() === "") {
      return isPreview ? (
        <div className="text-gray-500 italic">Loading content...</div>
      ) : (
        <div className="text-gray-500 italic text-center">No content available</div>
      );
    }
    
    // Split into lines for processing
    const lines = text.split("\n");
    
    return lines.map((line, index) => {
      // Headers
      if (line.startsWith("# ")) {
        return (
          <h1
            key={index}
            className={cn(
              "font-bold mb-4",
              isPreview ? "text-2xl" : "text-4xl"
            )}
          >
            {line.substring(2)}
          </h1>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h2
            key={index}
            className={cn(
              "font-bold mb-3",
              isPreview ? "text-xl" : "text-3xl"
            )}
          >
            {line.substring(3)}
          </h2>
        );
      }
      if (line.startsWith("### ")) {
        return (
          <h3
            key={index}
            className={cn(
              "font-bold mb-2",
              isPreview ? "text-lg" : "text-2xl"
            )}
          >
            {line.substring(4)}
          </h3>
        );
      }
      
      // List items
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <li key={index} className="ml-6 mb-1 list-disc">
            {line.substring(2)}
          </li>
        );
      }
      
      // Code blocks (simple)
      if (line.startsWith("```")) {
        return null; // Skip code fence markers
      }
      
      // Regular paragraph
      if (line.trim()) {
        return (
          <p key={index} className="mb-3">
            {line}
          </p>
        );
      }
      
      // Empty line
      return <br key={index} />;
    });
  };

  return (
    <>
      {/* Preview Tile */}
      <div
        onClick={openFullScreen}
        className={cn(
          "relative overflow-hidden bg-black text-gray-100 rounded-lg shadow-lg cursor-pointer transition-all duration-300",
          "hover:shadow-xl hover:scale-[1.02]",
          state?.isFullScreen && "opacity-0 pointer-events-none"
        )}
        style={{
          height: tileHeight,
          fontFamily: "'PP Editorial New', 'Georgia', serif",
        }}
      >
        <div className="p-6 h-full flex flex-col">
          {/* Title */}
          <h3 className="text-lg font-semibold mb-3 text-gray-200">
            {title}
          </h3>

          {/* Preview Content */}
          <div className="flex-1 overflow-hidden text-sm text-gray-300 leading-relaxed">
            {renderMarkdown(preview, true)}
          </div>

          {/* Read More Indicator */}
          {hasMore && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black to-transparent pointer-events-none" />
          )}
          
          <div className="absolute bottom-4 right-4 text-gray-400 text-xs flex items-center gap-1">
            <span>Click to read</span>
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Full Screen Viewer */}
      {state?.isFullScreen && (
        <div
          className={cn(
            "fixed inset-0 z-50 bg-black",
            state.isAnimating
              ? state.isFullScreen
                ? "animate-in fade-in-0 duration-300"
                : "animate-out fade-out-0 duration-300"
              : ""
          )}
          style={{
            fontFamily: "'PP Editorial New', 'Georgia', serif",
          }}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm border-b border-gray-800">
            <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
              <h1 className="text-2xl font-bold text-gray-100">{title}</h1>
              <button
                onClick={closeFullScreen}
                className="p-2 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-100"
                aria-label="Close full screen"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto h-full pb-20">
            <div className="max-w-4xl mx-auto px-6 py-8">
              <div className="prose prose-invert prose-lg max-w-none">
                <div className="text-gray-100 leading-relaxed">
                  {renderMarkdown(content || "")}
                </div>
              </div>
            </div>
          </div>

          {/* Footer hint */}
          <div className="fixed bottom-4 right-4 text-gray-500 text-sm">
            Press ESC to close
          </div>
        </div>
      )}
    </>
  );
}

// Default export for convenience
export default MarkdownViewer; 