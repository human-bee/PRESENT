/**
 * Progressive Loading Demo Page
 * 
 * Showcases the "Instant Skeleton, Progressive Soul" loading system
 */

"use client";

import { useState } from "react";
import { WeatherForecast } from "@/components/ui/weather-forecast";
import { ActionItemTracker } from "@/components/ui/action-item-tracker";
import { RetroTimerEnhanced } from "@/components/ui/retro-timer-enhanced";
import { Loader2, Zap, RefreshCw } from "lucide-react";

export default function ProgressiveLoadingDemo() {
  const [resetKey, setResetKey] = useState(0);
  
  const handleReset = () => {
    setResetKey(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-slate-950 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center space-x-3">
            <Zap className="w-8 h-8 text-yellow-400" />
            <h1 className="text-4xl font-bold text-white">
              Progressive Loading Demo
            </h1>
          </div>
          <p className="text-xl text-slate-300">
            "Instant Skeleton, Progressive Soul" - Components appear instantly!
          </p>
          <div className="flex items-center justify-center space-x-6 text-sm text-slate-400">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-slate-700 rounded-full" />
              <span>Skeleton &lt;100ms</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-slate-500 rounded-full" />
              <span>Partial &lt;200ms</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-full" />
              <span>Complete &lt;500ms</span>
            </div>
          </div>
          
          {/* Reset Button */}
          <button
            onClick={handleReset}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reset All Components</span>
          </button>
        </div>

        {/* Demo Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Weather Forecast Demo */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Weather Forecast</h3>
            <div key={`weather-${resetKey}`}>
              <WeatherForecast
                location="San Francisco, CA"
                viewType="current"
                periods={[
                  {
                    name: "Today",
                    temperature: "72°F",
                    wind: { speed: "10 mph", direction: "W" },
                    condition: "Sunny",
                    humidity: 65,
                    precipitation: 0,
                  },
                  {
                    name: "Tonight",
                    temperature: "58°F",
                    wind: { speed: "5 mph", direction: "SW" },
                    condition: "Clear",
                    humidity: 75,
                  },
                  {
                    name: "Tomorrow",
                    temperature: "75°F",
                    wind: { speed: "12 mph", direction: "W" },
                    condition: "Partly Cloudy",
                    humidity: 60,
                    precipitation: 10,
                  },
                ]}
              />
            </div>
          </div>

          {/* Timer Demo */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Retro Timer</h3>
            <div key={`timer-${resetKey}`}>
              <RetroTimerEnhanced
                initialMinutes={5}
                title="Demo Timer"
                showPresets={true}
                componentId={`timer-demo-${resetKey}`}
              />
            </div>
          </div>

          {/* Action Items Demo */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Action Item Tracker</h3>
            <div key={`actions-${resetKey}`}>
              <ActionItemTracker
                title="Demo Tasks"
                initialItems={[
                  {
                    id: "1",
                    text: "Review progressive loading implementation",
                    status: "pending",
                    priority: "high",
                    assignee: "Alex",
                    dueDate: new Date(Date.now() + 86400000).toISOString(),
                    createdAt: new Date().toISOString(),
                  },
                  {
                    id: "2",
                    text: "Test skeleton states across components",
                    status: "pending",
                    priority: "medium",
                    assignee: "Sam",
                    dueDate: new Date(Date.now() + 172800000).toISOString(),
                    createdAt: new Date().toISOString(),
                  },
                  {
                    id: "3",
                    text: "Optimize loading animations",
                    status: "completed",
                    priority: "low",
                    assignee: "Jordan",
                    createdAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                  },
                ]}
                className="h-[400px]"
              />
            </div>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="mt-12 p-6 bg-slate-900 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">Performance Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400">&lt;100ms</div>
              <p className="text-sm text-slate-400 mt-1">Skeleton Render Time</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">&lt;200ms</div>
              <p className="text-sm text-slate-400 mt-1">Partial Data Load</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-400">&lt;500ms</div>
              <p className="text-sm text-slate-400 mt-1">Complete Render</p>
            </div>
          </div>
          
          <div className="mt-6 space-y-2">
            <div className="flex items-center space-x-3">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
              <p className="text-sm text-slate-300">
                Progressive loading eliminates perceived latency
              </p>
            </div>
            <p className="text-sm text-slate-400">
              Users see content immediately with smooth transitions as data loads
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}