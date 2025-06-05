"use client";

/**
 * @file test-chat.tsx
 * @description Example of how to integrate parallel tools with Tambo chat
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ParallelToolsChatTest() {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Test Parallel Tools with Tambo Chat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <h3 className="font-semibold">Try these prompts in the chat:</h3>
          <div className="space-y-1 text-sm">
            <div className="p-2 bg-muted rounded-md font-mono">
              "Create a parallel research panel for AI trends, quantum computing, and blockchain"
            </div>
            <div className="p-2 bg-muted rounded-md font-mono">
              "Show me a parallel tools demo with machine learning topics"
            </div>
            <div className="p-2 bg-muted rounded-md font-mono">
              "Generate a research panel that can execute 5 tools in parallel"
            </div>
          </div>
        </div>
        
        <div className="space-y-2">
          <h3 className="font-semibold">What happens:</h3>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>Tambo AI will recognize the request for parallel execution</li>
            <li>It will generate a ParallelResearchPanel component</li>
            <li>The component will appear on the canvas with your specified topics</li>
            <li>You can then execute the research tools in parallel</li>
            <li>Watch real-time progress and see performance improvements</li>
          </ul>
        </div>

        <div className="p-4 bg-blue-50 rounded-md">
          <p className="text-sm text-blue-700">
            <strong>💡 Tip:</strong> The parallel tools system automatically detects dependencies 
            between tools and groups them for optimal parallel execution. Try asking for tools 
            that depend on each other to see the intelligent scheduling in action!
          </p>
        </div>
      </CardContent>
    </Card>
  );
} 