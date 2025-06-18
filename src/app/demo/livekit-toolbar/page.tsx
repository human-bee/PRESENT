"use client";

// Force dynamic rendering to prevent build errors
export const dynamic = 'force-dynamic';

import React from 'react';
import { LivekitToolbarDemo } from '@/components/ui/livekit-toolbar-demo';

// Force client-side rendering to prevent SSG issues with Tambo hooks


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