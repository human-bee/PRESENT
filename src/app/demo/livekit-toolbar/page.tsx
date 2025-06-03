"use client";

import React from 'react';
import { LivekitToolbarDemo } from '@/components/ui/livekit-toolbar-demo';

/**
 * LiveKit Toolbar Demo Page
 * 
 * Access this page at /demo/livekit-toolbar to test all toolbar integrations
 */
export default function LivekitToolbarDemoPage() {
  return (
    <div className="min-h-screen bg-background">
      <LivekitToolbarDemo />
    </div>
  );
} 