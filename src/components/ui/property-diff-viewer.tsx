import React from "react";
import { PropertyDiff } from "@/lib/component-registry";
import { cn } from "@/lib/utils";

export interface PropertyDiffViewerProps {
  diffs: PropertyDiff[];
  className?: string;
}

/**
 * Simple viewer that lists property changes with previous → next values.
 * Displays additions in green, removals in red and modifications in yellow.
 */
export function PropertyDiffViewer({ diffs, className }: PropertyDiffViewerProps) {
  if (!diffs || diffs.length === 0) {
    return <div className="text-slate-400 italic">No changes recorded</div>;
  }

  return (
    <div className={cn("space-y-2 text-sm", className)}>
      {diffs.slice(-20).map((d, idx) => (
        <div
          key={idx}
          className="bg-slate-800/60 rounded-md px-3 py-2 flex flex-col gap-1"
        >
          <div className="text-xs text-slate-500">
            {new Date(d.ts).toLocaleTimeString()} • <span className="font-mono">{d.key}</span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="line-through text-red-400 break-all max-w-[45%]">
              {JSON.stringify(d.previous)}
            </span>
            <span className="text-slate-500">→</span>
            <span className="text-green-400 break-all max-w-[45%]">
              {JSON.stringify(d.next)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PropertyDiffViewer; 