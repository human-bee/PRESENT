"use client";

/**
 * @file demo/parallel-tools/page.tsx
 * @description Demo page for testing parallel tool execution
 */

import React, { useState } from 'react';
import { ParallelResearchPanel } from '@/components/ui/parallel-research-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, X, Zap, Settings } from 'lucide-react';

export const runtime = 'edge';

export default function ParallelToolsDemo() {
  const [topics, setTopics] = useState<string[]>([
    'Artificial Intelligence trends 2025',
    'Quantum Computing applications',
    'Blockchain in healthcare'
  ]);
  const [newTopic, setNewTopic] = useState('');
  const [enableParallel, setEnableParallel] = useState(true);
  const [maxConcurrency, setMaxConcurrency] = useState(3);
  const [autoExecute, setAutoExecute] = useState(false);

  const addTopic = () => {
    if (newTopic.trim() && !topics.includes(newTopic.trim())) {
      setTopics([...topics, newTopic.trim()]);
      setNewTopic('');
    }
  };

  const removeTopic = (index: number) => {
    setTopics(topics.filter((_, i) => i !== index));
  };

  const addSampleTopics = () => {
    const samples = [
      'Machine Learning in autonomous vehicles',
      'Sustainable energy technologies',
      'Space exploration missions 2025',
      'Biotech innovations in medicine',
      'Future of remote work technologies'
    ];
    
    const newSamples = samples.filter(sample => !topics.includes(sample)).slice(0, 3);
    setTopics([...topics, ...newSamples]);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
            Parallel Tools Demo
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Test the power of parallel AI tool execution. Add research topics and watch them execute concurrently 
            with real-time progress tracking and performance metrics.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Configuration Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Topic Management */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Research Topics</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add research topic..."
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addTopic()}
                    />
                    <Button onClick={addTopic} size="sm">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {topics.map((topic, index) => (
                      <div key={index} className="flex items-center justify-between gap-2 p-2 bg-muted rounded-md">
                        <span className="text-sm truncate">{topic}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTopic(index)}
                          className="h-6 w-6 p-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button onClick={addSampleTopics} variant="outline" size="sm" className="w-full">
                    Add Sample Topics
                  </Button>
                </div>

                <Separator />

                {/* Execution Settings */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Parallel Execution</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={enableParallel}
                        onChange={(e) => setEnableParallel(e.target.checked)}
                        className="rounded"
                      />
                      {enableParallel && <Zap className="h-4 w-4 text-yellow-500" />}
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Max Concurrency: {maxConcurrency}</label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={maxConcurrency}
                      onChange={(e) => setMaxConcurrency(parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Auto Execute</label>
                    <input
                      type="checkbox"
                      checked={autoExecute}
                      onChange={(e) => setAutoExecute(e.target.checked)}
                      className="rounded"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Performance Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Expected Performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Sequential Time:</span>
                  <span className="font-mono">{topics.length * 2}s</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Parallel Time:</span>
                  <span className="font-mono text-green-600">
                    {enableParallel ? Math.ceil(topics.length / maxConcurrency) * 2 : topics.length * 2}s
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>Expected Speedup:</span>
                  <Badge variant={enableParallel ? "success" : "secondary"}>
                    {enableParallel ? (topics.length * 2 / (Math.ceil(topics.length / maxConcurrency) * 2)).toFixed(1) : "1.0"}x
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Parallel Research Panel */}
          <div className="lg:col-span-2">
            <ParallelResearchPanel
              topics={topics}
              enableParallel={enableParallel}
              maxConcurrency={maxConcurrency}
              autoExecute={autoExecute}
            />
          </div>
        </div>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>How to Test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. <strong>Add Topics:</strong> Use the input field to add research topics you want to explore</p>
            <p>2. <strong>Configure Settings:</strong> Toggle parallel execution and adjust concurrency limits</p>
            <p>3. <strong>Start Research:</strong> Click "Start Research" to see parallel tool execution in action</p>
            <p>4. <strong>Monitor Progress:</strong> Watch the real-time progress indicators and execution metrics</p>
            <p>5. <strong>Compare Performance:</strong> Try with parallel enabled vs disabled to see the speedup</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 