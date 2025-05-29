"use client";

import { cn } from "@/lib/utils";
import { useTambo } from "@tambo-ai/react";
import * as React from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Props for the ScrollableMessageContainer component
 */
export type ScrollableMessageContainerProps =
  React.HTMLAttributes<HTMLDivElement>;

/**
 * A scrollable container for message content with smart auto-scroll functionality.
 * Used across message thread components for consistent scrolling behavior.
 * Only auto-scrolls when user is already at the bottom, preserving manual scroll position.
 *
 * @example
 * ```tsx
 * <ScrollableMessageContainer>
 *   <ThreadContent variant="default">
 *     <ThreadContentMessages />
 *   </ThreadContent>
 * </ScrollableMessageContainer>
 * ```
 */
export const ScrollableMessageContainer = React.forwardRef<
  HTMLDivElement,
  ScrollableMessageContainerProps
>(({ className, children, ...props }, ref) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { thread } = useTambo();
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const previousMessageCount = useRef(0);
  const previousLastMessageId = useRef<string | null>(null);

  // Handle forwarded ref
  React.useImperativeHandle(ref, () => scrollContainerRef.current!, []);

  // Track scroll position to determine if user is near bottom
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 100; // 100px from bottom
    const nearBottom = scrollTop + clientHeight >= scrollHeight - threshold;
    
    setIsNearBottom(nearBottom);
    setUserHasScrolled(true);
  };

  // Smart auto-scroll: only scroll when user is already at bottom, or when new messages arrive
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !thread?.messages?.length) return;

    const currentMessageCount = thread.messages.length;
    const currentLastMessageId = thread.messages[thread.messages.length - 1]?.id;
    
    // Detect if this is a genuinely new message (not just a refresh/reload)
    const hasNewMessage = 
      currentMessageCount > previousMessageCount.current ||
      (currentLastMessageId && currentLastMessageId !== previousLastMessageId.current);

    // For new threads or first load, always scroll to bottom
    if (!userHasScrolled) {
      const timeoutId = setTimeout(() => {
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
          setIsNearBottom(true);
        }
      }, 100);

      // Update tracking refs
      previousMessageCount.current = currentMessageCount;
      previousLastMessageId.current = currentLastMessageId;

      return () => clearTimeout(timeoutId);
    }

    // Force scroll for new messages (like when user sends a message and gets response)
    // OR when user is already near bottom
    if (hasNewMessage || isNearBottom) {
      const timeoutId = setTimeout(() => {
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
          setIsNearBottom(true);
        }
      }, 100);

      // Update tracking refs
      previousMessageCount.current = currentMessageCount;
      previousLastMessageId.current = currentLastMessageId;

      return () => clearTimeout(timeoutId);
    }

    // Update tracking refs even if we don't scroll
    previousMessageCount.current = currentMessageCount;
    previousLastMessageId.current = currentLastMessageId;
  }, [thread?.messages, isNearBottom, userHasScrolled]);

  // Reset scroll tracking when thread changes
  useEffect(() => {
    setUserHasScrolled(false);
    setIsNearBottom(true);
    // Reset message tracking for new thread
    previousMessageCount.current = 0;
    previousLastMessageId.current = null;
  }, [thread?.id]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className={cn(
        "flex-1 overflow-y-auto",
        "[&::-webkit-scrollbar]:w-[6px]",
        "[&::-webkit-scrollbar-thumb]:bg-gray-300",
        "[&::-webkit-scrollbar:horizontal]:h-[4px]",
        className,
      )}
      data-slot="scrollable-message-container"
      {...props}
    >
      {children}
    </div>
  );
});
ScrollableMessageContainer.displayName = "ScrollableMessageContainer";
