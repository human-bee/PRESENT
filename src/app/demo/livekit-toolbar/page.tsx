"use client";

// Force dynamic rendering and use edge runtime to prevent build errors
export const dynamic = 'force-dynamic';
export const runtime = 'edge';

import React from 'react';
import dynamic from 'next/dynamic';

// Dynamic import for LiveKit toolbar demo - only load when demo page is accessed
const LivekitToolbarDemo = dynamic(() => import('@/components/ui/livekit-toolbar-demo'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center min-h-screen">
    <div className="text-lg text-slate-600">Loading LiveKit demo...</div>
  </div>
});

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