"use client";

import { cn } from "@/lib/utils";
import {
  ArrowUp,
  BookOpen,
  Clock,
  Image as ImageIcon,
  Search,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";

// Define the component props schema with Zod
export const markdownViewerEditableSchema = z.object({
  title: z.string().describe("Title of the document"),
  content: z.string().optional().describe("Markdown content to display"),
  author: z.string().optional().describe("Document author"),
  readTime: z.number().optional().describe("Estimated read time in minutes"),
  publishDate: z.string().optional().describe("Publish date"),
});

// Define the props type based on the Zod schema
export type MarkdownViewerEditableProps = z.infer<
  typeof markdownViewerEditableSchema
>;

// Component state type
type MarkdownViewerEditableState = {
  fontSize: number;
  readingProgress: number;
  showTOC: boolean;
  searchTerm: string;
  isSearching: boolean;
  currentHeading: string;
};

// Table of contents item type
type TOCItem = {
  id: string;
  title: string;
  level: number;
  element?: HTMLElement;
};

/**
 * Premium MarkdownViewer Component
 *
 * A beautifully designed markdown viewer with editorial typography,
 * interactive features, and smooth animations.
 */
export function MarkdownViewerEditable({
  title,
  content = "",
  author,
  readTime,
  publishDate,
}: MarkdownViewerEditableProps) {
  // State management
  const [state, setState] = useState<MarkdownViewerEditableState>({
    fontSize: 16,
    readingProgress: 0,
    showTOC: false,
    searchTerm: "",
    isSearching: false,
    currentHeading: "",
  });

  const [toc, setTOC] = useState<TOCItem[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (imageModal) {
          setImageModal(null);
        }
      }

      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case "f":
            e.preventDefault();
            setState((prev) => ({ ...prev, isSearching: !prev.isSearching }));
            break;
          case "+":
          case "=":
            e.preventDefault();
            setState((prev) => ({
              ...prev,
              fontSize: Math.min(prev.fontSize + 2, 24),
            }));
            break;
          case "-":
            e.preventDefault();
            setState((prev) => ({
              ...prev,
              fontSize: Math.max(prev.fontSize - 2, 12),
            }));
            break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyboard);
    return () => {
      document.removeEventListener("keydown", handleKeyboard);
    };
  }, [imageModal]);

  // Reading progress tracking
  useEffect(() => {
    if (!contentRef.current) return;

    const handleScroll = () => {
      const element = contentRef.current;
      if (!element) return;

      const scrollTop = element.scrollTop;
      const scrollHeight = element.scrollHeight - element.clientHeight;
      const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

      // Update current heading
      const headings = element.querySelectorAll("h1, h2, h3, h4, h5, h6");
      let currentHeading = "";

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i] as HTMLElement;
        if (heading.offsetTop <= scrollTop + 100) {
          currentHeading = heading.textContent || "";
          break;
        }
      }

      setState((prev) => ({
        ...prev,
        readingProgress: Math.min(Math.max(progress, 0), 100),
        currentHeading,
      }));
    };

    const element = contentRef.current;
    element.addEventListener("scroll", handleScroll);
    return () => element.removeEventListener("scroll", handleScroll);
  }, []);

  // Generate table of contents
  useEffect(() => {
    if (!content) return;

    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const tocItems: TOCItem[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const title = match[2].trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      tocItems.push({
        id,
        title,
        level,
      });
    }

    setTOC(tocItems);
  }, [content]);

  // Scroll to heading
  const scrollToHeading = (id: string) => {
    if (!contentRef.current) return;
    const element = contentRef.current.querySelector(`#${id}`) as HTMLElement;
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setState((prev) => ({ ...prev, showTOC: false }));
    }
  };

  // Enhanced markdown rendering with image support
  const renderMarkdown = (text: string) => {
    if (!text || text.trim() === "") {
      return (
        <div className="text-slate-500 italic text-center">
          No content available
        </div>
      );
    }

    const lines = text.split("\n");
    const elements: React.JSX.Element[] = [];
    let inCodeBlock = false;
    let codeContent: string[] = [];

    lines.forEach((line, index) => {
      // Handle search highlighting
      const highlightedLine =
        state?.searchTerm && state.searchTerm.length > 2
          ? line.replace(
              new RegExp(`(${state.searchTerm})`, "gi"),
              '<mark class="bg-yellow-300 text-black px-1 rounded">$1</mark>'
            )
          : line;

      // Code blocks
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          // End code block
          elements.push(
            <div
              key={`code-${index}`}
              className="my-6 rounded-xl overflow-hidden bg-slate-900 border border-slate-700"
            >
              <div className="bg-slate-800 px-4 py-2 text-xs text-slate-400 font-mono">
                Code
              </div>
              <pre className="p-4 overflow-x-auto">
                <code className="text-sm font-mono text-green-400">
                  {codeContent.join("\n")}
                </code>
              </pre>
            </div>
          );
          codeContent = [];
          inCodeBlock = false;
        } else {
          // Start code block
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeContent.push(line);
        return;
      }

      // Images
      const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (imageMatch) {
        const [, alt, src] = imageMatch;
        elements.push(
          <div key={`img-${index}`} className="my-8 text-center">
            <div
              className="inline-block cursor-pointer group transition-all duration-300 hover:scale-105"
              onClick={() => setImageModal(src)}
            >
              <img
                src={src}
                alt={alt}
                className="max-w-full h-auto rounded-xl shadow-lg"
                loading="lazy"
              />
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 mt-2">
                <span className="text-xs text-slate-400 flex items-center justify-center gap-1">
                  <ImageIcon size={12} />
                  Click to expand
                </span>
              </div>
            </div>
            {alt && <p className="text-sm text-slate-500 mt-2 italic">{alt}</p>}
          </div>
        );
        return;
      }

      // Headers with IDs for navigation
      if (line.startsWith("# ")) {
        const text = line.substring(2);
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        elements.push(
          <h1
            key={`h1-${index}`}
            id={id}
            className="font-bold text-white scroll-mt-20 text-4xl mb-6 mt-8"
            dangerouslySetInnerHTML={{ __html: highlightedLine.substring(2) }}
          />
        );
        return;
      }

      if (line.startsWith("## ")) {
        const text = line.substring(3);
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        elements.push(
          <h2
            key={`h2-${index}`}
            id={id}
            className="font-bold text-white scroll-mt-20 text-3xl mb-4 mt-6"
            dangerouslySetInnerHTML={{ __html: highlightedLine.substring(3) }}
          />
        );
        return;
      }

      if (line.startsWith("### ")) {
        const text = line.substring(4);
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        elements.push(
          <h3
            key={`h3-${index}`}
            id={id}
            className="font-semibold text-white scroll-mt-20 text-2xl mb-3 mt-5"
            dangerouslySetInnerHTML={{ __html: highlightedLine.substring(4) }}
          />
        );
        return;
      }

      // Links
      const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/g);
      if (linkMatch) {
        let processedLine = highlightedLine;
        linkMatch.forEach((match) => {
          const [, text, url] = match.match(/\[([^\]]+)\]\(([^)]+)\)/) || [];
          if (text && url) {
            processedLine = processedLine.replace(
              match,
              `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1 transition-colors">${text} <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></a>`
            );
          }
        });
        elements.push(
          <p
            key={`link-${index}`}
            className="mb-4 leading-relaxed text-slate-300"
            dangerouslySetInnerHTML={{ __html: processedLine }}
          />
        );
        return;
      }

      // List items
      if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li
            key={`li-${index}`}
            className="ml-6 mb-2 list-disc text-slate-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightedLine.substring(2) }}
          />
        );
        return;
      }

      // Blockquotes
      if (line.startsWith("> ")) {
        elements.push(
          <blockquote
            key={`quote-${index}`}
            className="border-l-4 border-blue-500 pl-4 my-4 italic text-slate-400 bg-slate-800/30 py-2 rounded-r-lg"
          >
            <span
              dangerouslySetInnerHTML={{ __html: highlightedLine.substring(2) }}
            />
          </blockquote>
        );
        return;
      }

      // Regular paragraph
      if (line.trim()) {
        elements.push(
          <p
            key={`p-${index}`}
            className="mb-4 leading-relaxed text-slate-300"
            dangerouslySetInnerHTML={{ __html: highlightedLine }}
          />
        );
        return;
      }

      // Empty line
      if (line === "") {
        elements.push(<br key={`br-${index}`} />);
      }
    });

    return elements;
  };

  const wordCount = content
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  const estimatedReadTime = readTime || Math.ceil(wordCount / 200);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 rounded-2xl overflow-hidden">
      {/* Reading progress bar */}
      <div className="sticky top-0 left-0 right-0 h-1 bg-slate-800 z-50">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
          style={{ width: `${state.readingProgress}%` }}
        />
      </div>

      {/* Header */}
      <div className="sticky top-1 z-40 bg-slate-950/90 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold text-white truncate max-w-md">
                {title}
              </h1>
              {state.currentHeading && (
                <span className="text-sm text-slate-400 hidden md:block">
                  / {state.currentHeading}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {/* Font size controls */}
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    fontSize: Math.max(prev.fontSize - 2, 12),
                  }))
                }
                className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-300"
              >
                <ZoomOut size={16} />
              </button>
              <span className="text-xs text-slate-500 w-8 text-center">
                {state.fontSize}
              </span>
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    fontSize: Math.min(prev.fontSize + 2, 24),
                  }))
                }
                className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-300"
              >
                <ZoomIn size={16} />
              </button>

              {/* Table of contents */}
              {toc.length > 0 && (
                <button
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      showTOC: !prev.showTOC,
                    }))
                  }
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    state.showTOC
                      ? "bg-slate-700 text-white"
                      : "hover:bg-slate-800 text-slate-400 hover:text-slate-300"
                  )}
                >
                  <BookOpen size={16} />
                </button>
              )}

              {/* Search */}
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    isSearching: !prev.isSearching,
                  }))
                }
                className={cn(
                  "p-2 rounded-lg transition-colors",
                  state.isSearching
                    ? "bg-slate-700 text-white"
                    : "hover:bg-slate-800 text-slate-400 hover:text-slate-300"
                )}
              >
                <Search size={16} />
              </button>
            </div>
          </div>

          {/* Search bar */}
          {state.isSearching && (
            <div className="mt-4 animate-in slide-in-from-top-2 duration-300">
              <input
                type="text"
                placeholder="Search in document..."
                value={state.searchTerm}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    searchTerm: e.target.value,
                  }))
                }
                className="w-full max-w-md px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                autoFocus
              />
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex h-full pt-1">
        {/* Table of Contents Sidebar */}
        {state.showTOC && toc.length > 0 && (
          <div className="w-80 bg-slate-900 border-r border-slate-800 p-6 overflow-y-auto animate-in slide-in-from-left-2 duration-300">
            <h3 className="text-lg font-semibold text-white mb-4">
              Table of Contents
            </h3>
            <nav className="space-y-1">
              {toc.map((item, index) => (
                <button
                  key={index}
                  onClick={() => scrollToHeading(item.id)}
                  className={cn(
                    "block w-full text-left px-3 py-2 rounded-lg text-sm transition-colors hover:bg-slate-800",
                    item.level === 1 && "font-semibold text-white",
                    item.level === 2 && "text-slate-300 ml-2",
                    item.level >= 3 && "text-slate-400 ml-4"
                  )}
                >
                  {item.title}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Document content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <article className="max-w-4xl mx-auto px-8 py-12">
            {/* Article header */}
            <header className="mb-12 pb-8 border-b border-slate-800">
              <h1 className="text-4xl font-bold text-white mb-6 leading-tight">
                {title}
              </h1>

              <div className="flex flex-wrap items-center gap-6 text-sm text-slate-400">
                {author && (
                  <span className="flex items-center space-x-2">
                    <span>By</span>
                    <span className="text-slate-300 font-medium">{author}</span>
                  </span>
                )}
                {publishDate && (
                  <span>{new Date(publishDate).toLocaleDateString()}</span>
                )}
                <span className="flex items-center space-x-1">
                  <Clock size={14} />
                  <span>{estimatedReadTime} minute read</span>
                </span>
                <span className="flex items-center space-x-1">
                  <Type size={14} />
                  <span>{wordCount} words</span>
                </span>
              </div>
            </header>

            {/* Article content */}
            <div
              className="prose prose-invert prose-lg max-w-none"
              style={{ fontSize: `${state.fontSize}px` }}
            >
              <div className="text-slate-300 leading-relaxed">
                {renderMarkdown(content || "")}
              </div>
            </div>

            {/* Back to top */}
            <div className="mt-16 pt-8 border-t border-slate-800 text-center">
              <button
                onClick={() =>
                  contentRef.current?.scrollTo({
                    top: 0,
                    behavior: "smooth",
                  })
                }
                className="inline-flex items-center space-x-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors"
              >
                <ArrowUp size={16} />
                <span>Back to top</span>
              </button>
            </div>
          </article>
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="fixed bottom-4 right-4 text-slate-500 text-xs space-y-1">
        <div>⌘F Search • ⌘+/- Font size</div>
        <div>ESC Close images</div>
      </div>

      {/* Image modal */}
      {imageModal && (
        <div
          className="fixed inset-0 z-60 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setImageModal(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img
              src={imageModal}
              alt=""
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setImageModal(null)}
              className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Default export for convenience
export default MarkdownViewerEditable;
