"use client";

import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

// Define the component props schema with Zod
export const retroTimerSchema = z.object({
  title: z.string().optional().describe("Optional title for the timer"),
  initialMinutes: z
    .number()
    .optional()
    .describe("Initial timer value in minutes (default: 5)"),
  showPresets: z
    .boolean()
    .optional()
    .describe("Whether to show preset time buttons (default: true)"),
  soundUrl: z
    .string()
    .optional()
    .describe("URL to a sound file to play when timer completes"),
});

// Define the props type based on the Zod schema
export type RetroTimerProps = z.infer<typeof retroTimerSchema>;

// Component state type
type RetroTimerState = {
  timeRemaining: number; // in seconds
  isRunning: boolean;
  initialTime: number; // in seconds
  isCompleted: boolean; // to track if timer just completed for visual effects
};

/**
 * RetroTimer Component
 *
 * A retro-styled timer component with preset timer options and controls.
 */
export function RetroTimer({
  title,
  initialMinutes = 5,
  showPresets = true,
  soundUrl = "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3",
}: RetroTimerProps) {
  // Initialize Tambo component state
  const [state, setState] = useTamboComponentState<RetroTimerState>(
    "retro-timer",
    {
      timeRemaining: initialMinutes * 60,
      isRunning: false,
      initialTime: initialMinutes * 60,
      isCompleted: false,
    }
  );

  // Reference for interval ID
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Reference for audio element
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Create audio element on mount
  useEffect(() => {
    audioRef.current = new Audio(soundUrl);
    
    // Cleanup on unmount
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [soundUrl]);
  
  // Blink effect state when timer completes
  const [isBlinking, setIsBlinking] = useState(false);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Set timer to a specific number of minutes
  const setTimer = (minutes: number) => {
    if (!state) return;
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    const seconds = minutes * 60;
    setState({
      timeRemaining: seconds,
      isRunning: false,
      initialTime: seconds,
      isCompleted: false,
    });
    
    // Reset blinking state
    setIsBlinking(false);
  };

  // Toggle timer between running and paused
  const toggleTimer = () => {
    if (!state) return;
    setState({ ...state, isRunning: !state.isRunning });
  };

  // Reset timer to initial time
  const resetTimer = () => {
    if (!state) return;
    
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    setState({
      timeRemaining: state.initialTime,
      isRunning: false,
      initialTime: state.initialTime,
      isCompleted: false,
    });
    
    // Reset blinking state
    setIsBlinking(false);
  };

  // Timer tick effect
  useEffect(() => {
    if (!state) return;

    if (state.isRunning) {
      intervalRef.current = setInterval(() => {
        if (state.timeRemaining <= 0) {
          // Time's up - play sound and stop timer
          setState({ ...state, isRunning: false, isCompleted: true });
          
          // Play notification sound
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(e => 
              console.error("Error playing notification sound:", e)
            );
          }
          
          // Start blinking effect
          setIsBlinking(true);
          
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else {
          setState({
            ...state,
            timeRemaining: state.timeRemaining - 1,
          });
        }
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state?.isRunning, state?.timeRemaining]);

  // Blinking effect timeout
  useEffect(() => {
    if (isBlinking) {
      const blinkTimeout = setTimeout(() => {
        setIsBlinking(false);
        if (state) {
          setState({ ...state, isCompleted: false });
        }
      }, 3000);
      
      return () => clearTimeout(blinkTimeout);
    }
  }, [isBlinking, state]);

  // Calculate progress percentage
  const progressPercent = state
    ? (state.timeRemaining / state.initialTime) * 100
    : 100;

  return (
    <div className="w-full max-w-md mx-auto">
      {title && (
        <h2 className="text-xl font-bold text-center mb-4">{title}</h2>
      )}

      <div className="bg-gray-900 border-4 border-gray-700 rounded-lg p-6 shadow-lg">
        {/* Timer Display */}
        <div 
          className={cn(
            "bg-black border-2 border-gray-600 rounded-md p-4 mb-6 relative overflow-hidden transition-colors",
            isBlinking && "animate-pulse bg-red-900"
          )}
        >
          <div
            className="absolute bottom-0 left-0 bg-green-500/20 h-1"
            style={{ width: `${progressPercent}%` }}
          ></div>
          
          <div className={cn(
            "font-mono text-4xl text-center tracking-widest",
            isBlinking ? "text-red-400" : "text-green-500"
          )}>
            {state ? formatTime(state.timeRemaining) : "00:00"}
          </div>
        </div>

        {/* Preset Buttons */}
        {showPresets && (
          <div className="grid grid-cols-3 gap-2 mb-6">
            <button
              onClick={() => setTimer(5)}
              aria-label="Set timer to 5 minutes"
              className={cn(
                "py-2 px-4 rounded-md border-2 border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors",
                state?.initialTime === 5 * 60 && "bg-gray-700 border-gray-500"
              )}
            >
              5 min
            </button>
            <button
              onClick={() => setTimer(10)}
              aria-label="Set timer to 10 minutes"
              className={cn(
                "py-2 px-4 rounded-md border-2 border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors",
                state?.initialTime === 10 * 60 && "bg-gray-700 border-gray-500"
              )}
            >
              10 min
            </button>
            <button
              onClick={() => setTimer(20)}
              aria-label="Set timer to 20 minutes"
              className={cn(
                "py-2 px-4 rounded-md border-2 border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors",
                state?.initialTime === 20 * 60 && "bg-gray-700 border-gray-500"
              )}
            >
              20 min
            </button>
          </div>
        )}

        {/* Controls */}
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={toggleTimer}
            aria-label={state?.isRunning ? "Pause timer" : "Start timer"}
            className={cn(
              "py-3 px-6 rounded-md border-2 text-lg font-medium transition-colors",
              state?.isRunning
                ? "bg-yellow-600 border-yellow-700 text-white hover:bg-yellow-700"
                : "bg-green-600 border-green-700 text-white hover:bg-green-700"
            )}
          >
            {state?.isRunning ? "PAUSE" : "START"}
          </button>
          <button
            onClick={resetTimer}
            aria-label="Reset timer"
            className="py-3 px-6 rounded-md border-2 border-gray-600 bg-gray-700 text-white text-lg font-medium hover:bg-gray-600 transition-colors"
          >
            RESET
          </button>
        </div>
      </div>
    </div>
  );
}

// Default export for convenience
export default RetroTimer; 