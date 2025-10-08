"use client";

export interface JobLogProps {
  lines: Array<{ timestamp: number; message: string }>;
}

export function JobLog({ lines }: JobLogProps) {
  if (!lines.length) {
    return <div className="text-xs text-muted-foreground">No log entries</div>;
  }

  return (
    <div className="text-xs space-y-1 font-mono text-muted-foreground">
      {lines.map((line, index) => (
        <div key={`${line.timestamp}-${index}`}>
          <span className="text-muted-foreground/70 mr-2">
            {new Date(line.timestamp).toLocaleTimeString()}
          </span>
          <span className="text-foreground/90">{line.message}</span>
        </div>
      ))}
    </div>
  );
}
