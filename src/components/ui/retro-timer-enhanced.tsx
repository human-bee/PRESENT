/**
 * Enhanced RetroTimer with new simplified component registry
 * 
 * This demonstrates the new architecture:
 * 1. No complex bus systems
 * 2. Direct component registration
 * 3. Simple state management with React patterns
 * 4. Automatic AI update handling
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTamboComponentState } from '@tambo-ai/react';
import { useComponentRegistration } from '@/lib/component-registry';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';

// Enhanced schema with better defaults + Tambo message ID support
export const retroTimerEnhancedSchema = z.object({
  initialMinutes: z.number().min(1).max(120).default(5).describe("Initial timer duration in minutes"),
  initialSeconds: z.number().min(0).max(59).default(0).describe("Initial timer duration in seconds"),
  title: z.string().optional().describe("Timer title/label"),
  autoStart: z.boolean().default(false).describe("Start timer automatically"),
  showPresets: z.boolean().default(true).describe("Show preset time buttons"),
  componentId: z.string().default("retro-timer").describe("Unique component identifier"),
  __tambo_message_id: z.string().optional().describe("Internal: Tambo message ID for AI updates"),
});

export type RetroTimerEnhancedProps = z.infer<typeof retroTimerEnhancedSchema>;

interface TimerState {
  timeLeft: number; // in seconds
  isRunning: boolean;
  isFinished: boolean;
}

export function RetroTimerEnhanced({
  initialMinutes = 5,
  initialSeconds = 0,
  title,
  autoStart = false,
  showPresets = true,
  componentId = "retro-timer",
  __tambo_message_id,
}: RetroTimerEnhancedProps) {
  // Calculate initial time in seconds - memoized to prevent recalculation
  const initialTimeInSeconds = React.useMemo(() => 
    initialMinutes * 60 + initialSeconds, 
    [initialMinutes, initialSeconds]
  );
  
  // Stable initial state object
  const initialState = React.useMemo(() => ({
    timeLeft: initialTimeInSeconds,
    isRunning: autoStart,
    isFinished: false,
  }), [initialTimeInSeconds, autoStart]);
  
  // Local timer state
  const [state, setState] = useTamboComponentState<TimerState>(componentId, initialState);

  // Use the exact Tambo message ID if provided, otherwise create a stable one
  const effectiveMessageId = React.useMemo(() => {
    if (__tambo_message_id) {
      console.log(`[RetroTimerEnhanced] Using provided Tambo message ID: ${__tambo_message_id}`);
      return __tambo_message_id;
    }
    
    // Fallback: create a stable ID based on componentId
    const fallbackId = `timer-${componentId}`;
    console.log(`[RetroTimerEnhanced] Using fallback message ID: ${fallbackId}`);
    return fallbackId;
  }, [__tambo_message_id, componentId]);

  // Stable props object to prevent re-registration loops
  const stableProps = React.useMemo(() => ({
    initialMinutes, 
    initialSeconds, 
    title, 
    autoStart, 
    showPresets, 
    componentId
  }), [initialMinutes, initialSeconds, title, autoStart, showPresets, componentId]);

  // Handle AI updates via the new component registry - stable callback
  const handleAIUpdate = React.useCallback((patch: Record<string, unknown>) => {
    console.log(`[RetroTimerEnhanced] Received AI update:`, patch);
    
    // Handle initialMinutes update
    if ('initialMinutes' in patch && typeof patch.initialMinutes === 'number') {
      const patchSeconds = (patch.initialSeconds as number) || 0;
      const newTimeInSeconds = patch.initialMinutes * 60 + patchSeconds;
      setState(prev => prev ? {
        ...prev,
        timeLeft: newTimeInSeconds,
        isFinished: false,
        isRunning: false, // Reset to stopped state
      } : {
        timeLeft: newTimeInSeconds,
        isRunning: false,
        isFinished: false,
      });
    }
    
    // Handle other updates
    if ('autoStart' in patch && patch.autoStart === true) {
      setState(prev => {
        const currentInitialTime = stableProps.initialMinutes * 60 + stableProps.initialSeconds;
        return prev ? { ...prev, isRunning: true } : { 
          timeLeft: currentInitialTime, 
          isRunning: true, 
          isFinished: false 
        };
      });
    }
  }, [setState, stableProps]);
  
  useComponentRegistration(
    effectiveMessageId,
    'RetroTimerEnhanced',
    stableProps,
    'default', // context key
    handleAIUpdate
  );

  // Debug component registration
  React.useEffect(() => {
    console.log(`[RetroTimerEnhanced] Component registered:`, {
      messageId: effectiveMessageId,
      componentType: 'RetroTimerEnhanced',
      props: stableProps,
      title: title || `${initialMinutes} Minute Timer`
    });
  }, [effectiveMessageId, stableProps, title, initialMinutes]);

  // Timer logic - only depend on isRunning to prevent constant effect re-runs
  useEffect(() => {
    if (!state?.isRunning) return;

    const interval = setInterval(() => {
      setState(prev => {
        if (!prev || prev.timeLeft <= 1) {
          return {
            timeLeft: 0,
            isRunning: false,
            isFinished: true,
          };
        }
        return {
          ...prev,
          timeLeft: prev.timeLeft - 1,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state?.isRunning, setState]); // Remove timeLeft from deps to prevent re-runs

  // Control functions - all memoized to prevent re-renders
  const startPause = React.useCallback(() => {
    if (!state) return;
    setState({ ...state, isRunning: !state.isRunning });
  }, [state, setState]);

  const reset = React.useCallback(() => {
    setState({
      timeLeft: initialTimeInSeconds,
      isRunning: false,
      isFinished: false,
    });
  }, [setState, initialTimeInSeconds]);

  const setPresetTime = React.useCallback((minutes: number) => {
    setState({
      timeLeft: minutes * 60,
      isRunning: false,
      isFinished: false,
    });
  }, [setState]);

  if (!state) {
    return <div className="p-4">Loading timer...</div>;
  }

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn(
      "bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 text-white shadow-2xl",
      "border border-gray-700 max-w-sm mx-auto",
      state.isFinished && "ring-2 ring-red-500 ring-opacity-50"
    )}>
      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Clock className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold">
            {title || `${initialMinutes} Minute Timer`}
          </h3>
        </div>
        <div className="text-xs text-gray-400">
          Enhanced with AI Updates • {componentId}
        </div>
      </div>

      {/* Time Display */}
      <div className="text-center mb-6">
        <div className={cn(
          "text-6xl font-mono font-bold tracking-wider",
          state.isFinished ? "text-red-400 animate-pulse" : 
          state.isRunning ? "text-green-400" : "text-blue-400"
        )}>
          {formatTime(state.timeLeft)}
        </div>
        {state.isFinished && (
          <div className="text-red-400 text-sm mt-2 animate-bounce">
            Time's up! 🎉
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-3 mb-4">
        <button
          onClick={startPause}
          disabled={state.isFinished}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50",
            state.isRunning 
              ? "bg-yellow-600 hover:bg-yellow-700 text-white" 
              : "bg-green-600 hover:bg-green-700 text-white",
            state.isFinished && "opacity-50 cursor-not-allowed"
          )}
        >
          {state.isRunning ? (
            <>
              <Pause className="w-4 h-4" />
              Pause
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start
            </>
          )}
        </button>

        <button
          onClick={reset}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 text-white transition-all focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
      </div>

      {/* Preset Buttons */}
      {showPresets && (
        <div className="flex justify-center gap-2">
          {[5, 10, 20].map((minutes) => (
            <button
              key={minutes}
              onClick={() => setPresetTime(minutes)}
              className="px-3 py-1 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all"
            >
              {minutes}m
            </button>
          ))}
        </div>
      )}

      {/* Status indicator */}
      <div className="mt-4 text-center text-xs text-gray-500">
        Status: {state.isFinished ? 'Finished' : state.isRunning ? 'Running' : 'Stopped'}
        {state.isRunning && ' • AI can update while running'}
      </div>
    </div>
  );
} 