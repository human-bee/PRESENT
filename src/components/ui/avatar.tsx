/**
 * Avatar component for the Next.js application.
 * 
 * This component serves as a user avatar display.
 * It includes:
 * - A profile image
 * - A fallback display for when no image is available
 */

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
}

interface AvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
);
Avatar.displayName = "Avatar";

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, ...props }, ref) => (
    <img
      ref={ref}
      className={cn("aspect-square h-full w-full", className)}
      {...props}
    />
  )
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = React.forwardRef<HTMLDivElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-muted",
        className
      )}
      {...props}
    />
  )
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback }; 