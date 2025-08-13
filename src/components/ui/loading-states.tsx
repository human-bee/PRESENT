/**
 * Loading State Components
 * 
 * Reusable skeleton, shimmer effects, and loading indicators
 * for the progressive loading system.
 */

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { LoadingState, LoadingProgress, getProgressRingProps } from "@/lib/progressive-loading";

// Shimmer effect for loading skeletons
export function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("animate-shimmer", className)}>
      <div className="animate-shimmer-slide h-full w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

// Base skeleton component
export function Skeleton({
  className,
  children,
  animate = true,
}: {
  className?: string;
  children?: React.ReactNode;
  animate?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-slate-800/50",
        animate && "animate-pulse",
        className
      )}
    >
      {children}
      {animate && <Shimmer className="absolute inset-0" />}
    </div>
  );
}

// Text skeleton
export function TextSkeleton({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-4",
            i === lines - 1 && lines > 1 && "w-3/4" // Last line shorter
          )}
        />
      ))}
    </div>
  );
}

// Progress ring component
export function ProgressRing({
  progress,
  size = 40,
  strokeWidth = 3,
  color = "#3b82f6",
  showPercentage = false,
  className,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  showPercentage?: boolean;
  className?: string;
}) {
  const props = getProgressRingProps({ progress, size, strokeWidth, color });

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={props.size} height={props.size} className="transform -rotate-90">
        <circle
          cx={props.size / 2}
          cy={props.size / 2}
          r={props.radius}
          stroke="currentColor"
          strokeWidth={props.strokeWidth}
          fill="none"
          className="text-slate-700"
        />
        <circle
          cx={props.size / 2}
          cy={props.size / 2}
          r={props.radius}
          stroke={props.color}
          strokeWidth={props.strokeWidth}
          fill="none"
          strokeDasharray={props.strokeDasharray}
          strokeDashoffset={props.strokeDashoffset}
          className="transition-all duration-300 ease-out"
          strokeLinecap="round"
        />
      </svg>
      {showPercentage && (
        <span className="absolute text-xs font-medium text-white">
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );
}

// Loading indicator with message
export function LoadingIndicator({
  progress,
  className,
}: {
  progress: LoadingProgress;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center space-x-3", className)}>
      {progress.progress < 100 ? (
        <ProgressRing progress={progress.progress} size={24} strokeWidth={2} />
      ) : (
        <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-green-500" />
        </div>
      )}
      <div className="flex-1">
        <p className="text-sm font-medium text-white">{progress.message || "Loading..."}</p>
        {progress.eta && progress.eta > 0 && (
          <p className="text-xs text-slate-400">~{Math.ceil(progress.eta / 1000)}s remaining</p>
        )}
      </div>
    </div>
  );
}

// Component loading wrapper with transitions
export function LoadingWrapper({
  state,
  skeleton,
  children,
  className,
  showLoadingIndicator = true,
  loadingProgress,
}: {
  state: LoadingState;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  showLoadingIndicator?: boolean;
  loadingProgress?: LoadingProgress;
}) {
  return (
    <div className={cn("relative", className)}>
      {/* Loading indicator overlay */}
      {showLoadingIndicator && loadingProgress && state !== LoadingState.COMPLETE && (
        <div className="absolute top-2 right-2 z-10">
          <LoadingIndicator progress={loadingProgress} />
        </div>
      )}

      {/* Content with transitions */}
      <div
        className={cn(
          "transition-all duration-300 ease-out",
          state === LoadingState.SKELETON && "opacity-60 scale-[0.98]",
          state === LoadingState.PARTIAL && "opacity-80 scale-[0.99]",
          state === LoadingState.COMPLETE && "opacity-100 scale-100"
        )}
      >
        {state === LoadingState.SKELETON ? skeleton : children}
      </div>

      {/* Completion pulse effect */}
      {state === LoadingState.COMPLETE && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-green-500/10 rounded-lg animate-pulse-once" />
        </div>
      )}
    </div>
  );
}

// Common skeleton patterns
export const SkeletonPatterns = {
  // Card skeleton
  card: (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-3/4" />
      <TextSkeleton lines={3} />
      <div className="flex space-x-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  ),

  // Weather skeleton
  weather: (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="flex items-center justify-center">
        <Skeleton className="w-16 h-16 rounded-full" />
      </div>
      <div className="text-center space-y-2">
        <Skeleton className="h-12 w-24 mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  ),

  // Timer skeleton
  timer: (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48 mx-auto" />
      <div className="flex justify-center">
        <Skeleton className="w-32 h-32 rounded-full" />
      </div>
      <div className="flex justify-center space-x-2">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-20" />
      </div>
    </div>
  ),

  // List skeleton
  list: (count: number = 3) => (
    <div className="p-4 space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center space-x-3">
          <Skeleton className="w-10 h-10 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  ),

  // Form skeleton
  form: (
    <div className="p-6 space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-10 w-32" />
    </div>
  ),
};

// Add shimmer animation styles
if (typeof window !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    .animate-shimmer-slide {
      animation: shimmer 1.5s infinite;
    }
    @keyframes pulse-once {
      0% { opacity: 0; }
      50% { opacity: 1; }
      100% { opacity: 0; }
    }
    .animate-pulse-once {
      animation: pulse-once 0.5s ease-out;
    }
  `;
  document.head.appendChild(style);
}