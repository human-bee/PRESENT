"use client";

// Force dynamic rendering to prevent build errors
export const dynamic = 'force-dynamic';
export const prerender = false;

import dynamic from 'next/dynamic';

const LiveCaptionsPageImpl = dynamic(() => import('./LiveCaptionsPageImpl'), { 
  ssr: false,
  loading: () => <div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>
});

export default function LiveCaptionsDemo() {
  return <LiveCaptionsPageImpl />;
} 