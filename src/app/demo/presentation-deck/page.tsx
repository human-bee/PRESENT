"use client";

// Force dynamic rendering to prevent build errors
export const dynamic = 'force-dynamic';

import { PresentationDeck } from "@/components/ui/presentation-deck";

// Force client-side rendering to prevent SSG issues with Tambo hooks


const sampleSlides = [
  {
    id: "slide-1",
    title: "Welcome to Your Presentation",
    content: `
      <div class="text-center">
        <h1 class="text-4xl font-bold mb-6 text-slate-800">Welcome to the Future of Presentations</h1>
        <p class="text-xl text-slate-600 mb-8">Experience seamless navigation, beautiful design, and powerful features</p>
        <div class="flex justify-center space-x-4">
          <div class="bg-blue-100 p-4 rounded-lg">
            <h3 class="font-semibold text-blue-800">Hotkey Controls</h3>
            <p class="text-sm text-blue-600">Navigate with keyboard shortcuts</p>
          </div>
          <div class="bg-green-100 p-4 rounded-lg">
            <h3 class="font-semibold text-green-800">Laser Pointer</h3>
            <p class="text-sm text-green-600">Interactive presentation mode</p>
          </div>
          <div class="bg-purple-100 p-4 rounded-lg">
            <h3 class="font-semibold text-purple-800">Canvas Ready</h3>
            <p class="text-sm text-purple-600">Built for Tambo integration</p>
          </div>
        </div>
      </div>
    `,
    notes: "Welcome your audience with an overview of the presentation features. Highlight the key capabilities of this presentation tool.",
    duration: 45
  },
  {
    id: "slide-2",
    title: "Key Features",
    content: `
      <div>
        <h2 class="text-3xl font-bold mb-8 text-slate-800">Powerful Features Built In</h2>
        <div class="grid grid-cols-2 gap-8">
          <div class="space-y-4">
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span class="text-lg">Fullscreen presentation mode</span>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-green-500 rounded-full"></div>
              <span class="text-lg">Comprehensive hotkey support</span>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-purple-500 rounded-full"></div>
              <span class="text-lg">Interactive laser pointer</span>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-red-500 rounded-full"></div>
              <span class="text-lg">Speaker notes support</span>
            </div>
          </div>
          <div class="space-y-4">
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span class="text-lg">Thumbnail navigation</span>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-indigo-500 rounded-full"></div>
              <span class="text-lg">Auto-advance capability</span>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-pink-500 rounded-full"></div>
              <span class="text-lg">Progress tracking</span>
            </div>
            <div class="flex items-center space-x-3">
              <div class="w-3 h-3 bg-teal-500 rounded-full"></div>
              <span class="text-lg">Bookmark slides</span>
            </div>
          </div>
        </div>
      </div>
    `,
    notes: "Detail the comprehensive feature set. Press 'L' to activate laser pointer and demonstrate interactive capabilities.",
    duration: 60
  },
  {
    id: "slide-3",
    title: "Navigation Controls",
    content: `
      <div class="text-center">
        <h2 class="text-3xl font-bold mb-8 text-slate-800">Master the Keyboard</h2>
        <div class="bg-slate-100 p-8 rounded-lg">
          <div class="grid grid-cols-3 gap-6 text-sm">
            <div class="space-y-2">
              <h4 class="font-semibold text-slate-700">Navigation</h4>
              <div class="space-y-1 text-slate-600">
                <div>← → : Previous/Next</div>
                <div>Space : Next slide</div>
                <div>Home/End : First/Last</div>
              </div>
            </div>
            <div class="space-y-2">
              <h4 class="font-semibold text-slate-700">Control</h4>
              <div class="space-y-1 text-slate-600">
                <div>Enter : Play/Pause</div>
                <div>F : Fullscreen</div>
                <div>Esc : Exit fullscreen</div>
              </div>
            </div>
            <div class="space-y-2">
              <h4 class="font-semibold text-slate-700">Features</h4>
              <div class="space-y-1 text-slate-600">
                <div>T : Toggle thumbnails</div>
                <div>S : Toggle notes</div>
                <div>L : Laser pointer</div>
                <div>B : Bookmark slide</div>
              </div>
            </div>
          </div>
        </div>
        <p class="mt-6 text-lg text-slate-600">Try these shortcuts now!</p>
      </div>
    `,
    notes: "This is a great time to demonstrate the keyboard shortcuts. Press 'T' to show thumbnails, 'S' to toggle these notes, and 'L' for laser pointer mode.",
    duration: 90
  },
  {
    id: "slide-4",
    title: "Interactive Demo",
    content: `
      <div class="text-center">
        <h2 class="text-3xl font-bold mb-8 text-slate-800">Try It Yourself!</h2>
        <div class="bg-gradient-to-br from-blue-50 to-purple-50 p-8 rounded-xl">
          <div class="mb-6">
            <div class="w-24 h-24 bg-blue-500 rounded-full mx-auto flex items-center justify-center mb-4">
              <span class="text-white text-3xl font-bold">🚀</span>
            </div>
            <h3 class="text-2xl font-semibold text-slate-800 mb-4">Interactive Experience</h3>
            <p class="text-lg text-slate-600 mb-6">This slide is perfect for testing the laser pointer feature</p>
          </div>
          <div class="grid grid-cols-4 gap-4">
            <div class="bg-red-200 p-4 rounded-lg cursor-pointer hover:bg-red-300 transition-colors">
              <div class="w-8 h-8 bg-red-500 rounded-full mx-auto mb-2"></div>
              <p class="text-sm font-medium">Point Here</p>
            </div>
            <div class="bg-green-200 p-4 rounded-lg cursor-pointer hover:bg-green-300 transition-colors">
              <div class="w-8 h-8 bg-green-500 rounded-full mx-auto mb-2"></div>
              <p class="text-sm font-medium">Or Here</p>
            </div>
            <div class="bg-blue-200 p-4 rounded-lg cursor-pointer hover:bg-blue-300 transition-colors">
              <div class="w-8 h-8 bg-blue-500 rounded-full mx-auto mb-2"></div>
              <p class="text-sm font-medium">Maybe Here</p>
            </div>
            <div class="bg-purple-200 p-4 rounded-lg cursor-pointer hover:bg-purple-300 transition-colors">
              <div class="w-8 h-8 bg-purple-500 rounded-full mx-auto mb-2"></div>
              <p class="text-sm font-medium">Try This</p>
            </div>
          </div>
        </div>
      </div>
    `,
    notes: "Perfect slide for demonstrating the laser pointer. Press 'L' to activate it and move your mouse to point at different elements. The red dot will follow your cursor!",
    duration: 120
  },
  {
    id: "slide-5",
    title: "Thank You",
    content: `
      <div class="text-center">
        <h1 class="text-4xl font-bold mb-6 text-slate-800">Thank You!</h1>
        <div class="mb-8">
          <div class="text-6xl mb-4">🎉</div>
          <p class="text-xl text-slate-600 mb-6">You've experienced the power of modern presentation tools</p>
        </div>
        <div class="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 rounded-lg inline-block">
          <h3 class="text-2xl font-semibold mb-2">Ready to Present?</h3>
          <p class="text-lg opacity-90">Create stunning presentations with Tambo</p>
        </div>
        <div class="mt-8 text-sm text-slate-500">
          <p>Press 'R' to restart • 'F' for fullscreen • 'B' to bookmark this slide</p>
        </div>
      </div>
    `,
    notes: "Conclude the presentation by highlighting the key takeaways. This slide demonstrates the bookmark feature - press 'B' to bookmark it!",
    duration: 30
  }
];

export default function PresentationDeckDemo() {
  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-4">Presentation Deck Demo</h1>
          <p className="text-lg text-slate-600">
            Experience the full-featured presentation tool with hotkey controls, laser pointer, 
            and beautiful slide transitions. Try the keyboard shortcuts and interactive features!
          </p>
        </div>
        
        <div className="bg-white rounded-lg shadow-lg p-6">
          <PresentationDeck
            title="Sample Business Presentation"
            author="Tambo Demo"
            slides={sampleSlides}
            aspectRatio="16:9"
            theme="dark"
            showControls={true}
            showProgress={true}
            showNotes={false}
            enableLaserPointer={true}
            autoAdvance={false}
            autoAdvanceInterval={30}
            totalDuration={5.5}
            tags={["demo", "presentation", "tambo"]}
            createdAt={new Date().toISOString()}
          />
        </div>
        
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-3">🎯 Try These Features:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-700">
            <div>
              <h4 className="font-semibold mb-2">Navigation:</h4>
              <ul className="space-y-1">
                <li>• Use ← → arrow keys or Space to navigate</li>
                <li>• Press Enter to start/pause auto-play</li>
                <li>• Press F for fullscreen mode</li>
                <li>• Press Home/End to jump to first/last slide</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Interactive Features:</h4>
              <ul className="space-y-1">
                <li>• Press T to toggle thumbnail navigation</li>
                <li>• Press S to toggle speaker notes</li>
                <li>• Press L to activate laser pointer mode</li>
                <li>• Press B to bookmark current slide</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 