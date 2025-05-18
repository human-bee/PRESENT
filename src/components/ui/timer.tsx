'use client';
import { z } from "zod";
import React, { useState, useRef, useEffect } from "react";

export const timerSchema = z.object({
  label: z.string().optional().describe("Label for the timer (e.g. 'Pomodoro', 'Break')"),
  minutes: z.number().min(0).max(999).describe("Number of minutes for the timer"),
  seconds: z.number().min(0).max(59).optional().describe("Number of seconds for the timer (default 0)"),
});

export type TimerProps = z.infer<typeof timerSchema>;

export function Timer({ label, minutes, seconds = 0 }: TimerProps) {
  const [remaining, setRemaining] = useState(minutes * 60 + seconds);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (running && remaining > 0) {
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => Math.max(prev - 1, 0));
      }, 1000);
    } else if (!running && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  useEffect(() => {
    if (remaining === 0 && running) {
      setRunning(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [remaining, running]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="w-full max-w-xs mx-auto p-4 bg-white border rounded-lg shadow text-center">
      {label && <h3 className="text-lg font-semibold mb-2">{label}</h3>}
      <div className="text-4xl font-mono mb-4">
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </div>
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        onClick={() => setRunning((r) => !r)}
        disabled={remaining === 0}
      >
        {running ? "Pause" : remaining === 0 ? "Done" : "Start"}
      </button>
      {remaining !== minutes * 60 + seconds && !running && remaining !== 0 && (
        <button
          className="ml-2 px-3 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
          onClick={() => setRemaining(minutes * 60 + seconds)}
        >
          Reset
        </button>
      )}
    </div>
  );
} 