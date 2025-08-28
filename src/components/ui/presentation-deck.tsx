import { z } from "zod";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  ChevronLeft, ChevronRight, Play, Pause, Square, Maximize, 
  Minimize, RotateCcw, Settings, Eye, EyeOff, Clock,
  FileText, Download, Share2, Bookmark, Grid3X3, MousePointer
} from 'lucide-react';

// Slide schema for individual slide data
const slideSchema = z.object({
  id: z.string().describe("Unique slide identifier"),
  title: z.string().optional().describe("Slide title"),
  content: z.string().optional().describe("Slide content (HTML, Markdown, or text)"),
  imageUrl: z.string().optional().describe("Direct image URL for slide"),
  thumbnailUrl: z.string().optional().describe("Thumbnail image URL"),
  notes: z.string().optional().describe("Speaker notes for this slide"),
  duration: z.number().optional().describe("Suggested duration for this slide in seconds"),
  transition: z.enum(["fade", "slide", "zoom", "flip"]).optional().default("fade"),
});

// Main presentation schema
export const presentationDeckSchema = z.object({
  title: z.string().describe("Presentation title"),
  slides: z.array(slideSchema).describe("Array of slides in the presentation"),
  
  // Presentation source and format
  sourceType: z.enum(["powerpoint", "google-slides", "pdf", "images", "html", "markdown"])
    .optional().default("images").describe("Type of presentation source"),
  sourceUrl: z.string().optional().describe("URL to original presentation (Google Slides, etc.)"),
  
  // Display options
  aspectRatio: z.enum(["16:9", "4:3", "16:10"]).optional().default("16:9"),
  theme: z.enum(["dark", "light", "auto"]).optional().default("dark"),
  autoAdvance: z.boolean().optional().default(false).describe("Auto-advance slides"),
  autoAdvanceInterval: z.number().optional().default(30).describe("Seconds between auto-advance"),
  
  // Navigation and controls
  showControls: z.boolean().optional().default(true).describe("Show navigation controls"),
  showProgress: z.boolean().optional().default(true).describe("Show progress indicator"),
  showNotes: z.boolean().optional().default(false).describe("Show speaker notes"),
  enableLaserPointer: z.boolean().optional().default(true).describe("Enable laser pointer mode"),
  
  // Metadata
  totalDuration: z.number().optional().describe("Total presentation duration in minutes"),
  author: z.string().optional().describe("Presentation author"),
  createdAt: z.string().optional().describe("Creation date"),
  tags: z.array(z.string()).optional().describe("Presentation tags"),
});

// Type definitions
export type Slide = z.infer<typeof slideSchema>;
export type PresentationDeck = z.infer<typeof presentationDeckSchema>;
export type PresentationDeckProps = z.infer<typeof presentationDeckSchema>;

// Component state
type PresentationDeckState = {
  currentSlide: number;
  isPlaying: boolean;
  isFullscreen: boolean;
  showThumbnails: boolean;
  showNotes: boolean;
  playbackSpeed: number;
  canvasSize: { width: number; height: number };
  isActive: boolean;
  laserPointerActive: boolean;
  laserPointerPosition: { x: number; y: number };
  bookmarkedSlides: number[];
  presentationStartTime: Date | null;
  elapsedTime: number;
  userPreferences: {
    autoHideControls: boolean;
    keyboardShortcuts: boolean;
    transitionSpeed: "fast" | "normal" | "slow";
  };
};

// Hotkey definitions
const HOTKEYS = {
  NEXT_SLIDE: ["ArrowRight", "Space", "n", "j"],
  PREV_SLIDE: ["ArrowLeft", "p", "k"],
  FIRST_SLIDE: ["Home", "g g"],
  LAST_SLIDE: ["End", "G"],
  TOGGLE_PLAY: ["Enter"],
  FULLSCREEN: ["f", "F11"],
  EXIT_FULLSCREEN: ["Escape"],
  TOGGLE_THUMBNAILS: ["t"],
  TOGGLE_NOTES: ["s"],
  LASER_POINTER: ["l"],
  BOOKMARK: ["b"],
  RESET: ["r"],
} as const;

// Format time for display
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Progress indicator component
const ProgressIndicator = ({ current, total, showTime = false, elapsedTime = 0 }: {
  current: number;
  total: number;
  showTime?: boolean;
  elapsedTime?: number;
}) => (
  <div className="flex items-center space-x-3 text-sm text-slate-300">
    <span className="font-mono">{current + 1}/{total}</span>
    <div className="w-32 h-1 bg-slate-700 rounded-full overflow-hidden">
      <div 
        className="h-full bg-blue-400 rounded-full transition-all duration-300"
        style={{ width: `${((current + 1) / total) * 100}%` }}
      />
    </div>
    {showTime && (
      <span className="font-mono text-slate-400">
        <Clock size={12} className="inline mr-1" />
        {formatTime(elapsedTime)}
      </span>
    )}
  </div>
);

// Slide thumbnail component
const SlideThumbnail = ({ slide, index, isActive, onClick }: {
  slide: Slide;
  index: number;
  isActive: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`relative w-20 h-14 rounded border-2 transition-all duration-200 hover:scale-105 ${
      isActive 
        ? 'border-blue-400 bg-blue-400/10' 
        : 'border-slate-600 hover:border-slate-400'
    }`}
  >
    {slide.thumbnailUrl || slide.imageUrl ? (
      <img 
        src={slide.thumbnailUrl || slide.imageUrl}
        alt={`Slide ${index + 1}`}
        className="w-full h-full object-cover rounded"
      />
    ) : (
      <div className="w-full h-full bg-slate-800 rounded flex items-center justify-center">
        <FileText size={16} className="text-slate-400" />
      </div>
    )}
    <span className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 text-xs bg-slate-900 px-1 rounded">
      {index + 1}
    </span>
  </button>
);

// Main slide display component
const SlideDisplay = ({ slide, aspectRatio, laserPointer }: {
  slide: Slide;
  aspectRatio: string;
  laserPointer?: { x: number; y: number; active: boolean };
}) => {
  const aspectRatioClasses = {
    "16:9": "aspect-video",
    "4:3": "aspect-[4/3]",
    "16:10": "aspect-[16/10]"
  };

  return (
    <div className={`relative w-full ${aspectRatioClasses[aspectRatio as keyof typeof aspectRatioClasses]} bg-white rounded-lg overflow-hidden shadow-2xl`}>
      {slide.imageUrl ? (
        <img 
          src={slide.imageUrl}
          alt={slide.title || `Slide`}
          className="w-full h-full object-contain"
          draggable={false}
        />
      ) : slide.content ? (
        <div className="w-full h-full p-8 flex flex-col justify-center">
          {slide.title && (
            <h2 className="text-3xl font-bold text-slate-900 mb-6">{slide.title}</h2>
          )}
          <div 
            className="text-slate-700 text-lg leading-relaxed"
            dangerouslySetInnerHTML={{ __html: slide.content }}
          />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-100">
          <div className="text-center">
            <FileText size={48} className="text-slate-400 mx-auto mb-4" />
            <p className="text-slate-600">No content available</p>
          </div>
        </div>
      )}
      
      {/* Laser pointer */}
      {laserPointer?.active && (
        <div 
          className="absolute w-3 h-3 bg-red-500 rounded-full shadow-lg animate-pulse pointer-events-none"
          style={{
            left: `${laserPointer.x}%`,
            top: `${laserPointer.y}%`,
            transform: 'translate(-50%, -50%)'
          }}
        />
      )}
    </div>
  );
};

// Control panel component
const ControlPanel = ({ 
  currentSlide, 
  totalSlides, 
  isPlaying, 
  onPrevious, 
  onNext, 
  onTogglePlay, 
  onFullscreen,
  onToggleThumbnails,
  onToggleNotes,
  onToggleLaserPointer,
  onBookmark,
  onReset,
  showThumbnails,
  showNotes,
  laserPointerActive,
  isBookmarked 
}: {
  currentSlide: number;
  totalSlides: number;
  isPlaying: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onFullscreen: () => void;
  onToggleThumbnails: () => void;
  onToggleNotes: () => void;
  onToggleLaserPointer: () => void;
  onBookmark: () => void;
  onReset: () => void;
  showThumbnails: boolean;
  showNotes: boolean;
  laserPointerActive: boolean;
  isBookmarked: boolean;
}) => (
  <div className="flex items-center justify-between bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-lg px-4 py-2">
    <div className="flex items-center space-x-2">
      <button
        onClick={onPrevious}
        disabled={currentSlide === 0}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Previous slide (←)"
      >
        <ChevronLeft size={20} />
      </button>
      
      <button
        onClick={onTogglePlay}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title={isPlaying ? "Pause (Enter)" : "Play (Enter)"}
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      
      <button
        onClick={onNext}
        disabled={currentSlide === totalSlides - 1}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Next slide (→)"
      >
        <ChevronRight size={20} />
      </button>
      
      <button
        onClick={onReset}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title="Reset to first slide (R)"
      >
        <RotateCcw size={16} />
      </button>
    </div>
    
    <div className="flex items-center space-x-2">
      <button
        onClick={onBookmark}
        className={`p-2 rounded transition-colors ${
          isBookmarked 
            ? 'text-yellow-400 hover:text-yellow-300' 
            : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Bookmark slide (B)"
      >
        <Bookmark size={16} />
      </button>
      
      <button
        onClick={onToggleLaserPointer}
        className={`p-2 rounded transition-colors ${
          laserPointerActive 
            ? 'text-red-400 hover:text-red-300 bg-red-400/10' 
            : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Laser pointer (L)"
      >
        <MousePointer size={16} />
      </button>
      
      <button
        onClick={onToggleThumbnails}
        className={`p-2 rounded transition-colors ${
          showThumbnails 
            ? 'text-blue-400 hover:text-blue-300 bg-blue-400/10' 
            : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Toggle thumbnails (T)"
      >
        <Grid3X3 size={16} />
      </button>
      
      <button
        onClick={onToggleNotes}
        className={`p-2 rounded transition-colors ${
          showNotes 
            ? 'text-green-400 hover:text-green-300 bg-green-400/10' 
            : 'text-slate-300 hover:text-white hover:bg-slate-700'
        }`}
        title="Toggle notes (S)"
      >
        {showNotes ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      
      <button
        onClick={onFullscreen}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
        title="Fullscreen (F)"
      >
        <Maximize size={16} />
      </button>
    </div>
  </div>
);

// Speaker notes component
const SpeakerNotes = ({ notes }: { notes?: string }) => {
  if (!notes) return null;
  
  return (
    <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-300 mb-2 flex items-center">
        <FileText size={14} className="mr-2" />
        Speaker Notes
      </h4>
      <p className="text-sm text-slate-400 leading-relaxed">{notes}</p>
    </div>
  );
};

// Main component
export function PresentationDeck(props: PresentationDeckProps) {
  const componentId = `presentation-deck-${props.title.replace(/\s+/g, '-').toLowerCase()}`;
  
  // Local state
  const [state, setState] = useState<PresentationDeckState>({
    currentSlide: 0,
    isPlaying: false,
    isFullscreen: false,
    showThumbnails: false,
    showNotes: props.showNotes || false,
    playbackSpeed: 1,
    canvasSize: { width: 800, height: 600 },
    isActive: true,
    laserPointerActive: false,
    laserPointerPosition: { x: 50, y: 50 },
    bookmarkedSlides: [],
    presentationStartTime: null,
    elapsedTime: 0,
    userPreferences: {
      autoHideControls: false,
      keyboardShortcuts: true,
      transitionSpeed: "normal",
    },
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Handle mouse movement for laser pointer
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (state?.laserPointerActive && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setState(prev => ({
        ...prev!,
        laserPointerPosition: { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
      }));
    }
  }, [state?.laserPointerActive, setState]);

  // Auto-advance functionality
  useEffect(() => {
    if (!state || !props.autoAdvance || !state.isPlaying) return;

    const interval = setInterval(() => {
      if (state.currentSlide < props.slides.length - 1) {
        setState(prev => ({
          ...prev!,
          currentSlide: prev!.currentSlide + 1
        }));
      } else {
        setState(prev => ({ ...prev!, isPlaying: false }));
      }
    }, (props.autoAdvanceInterval || 30) * 1000);

    return () => clearInterval(interval);
  }, [state?.isPlaying, state?.currentSlide, props.autoAdvance, props.autoAdvanceInterval, props.slides.length, setState]);

  // Timer for elapsed time
  useEffect(() => {
    if (!state?.isPlaying || !state.presentationStartTime) return;

    const interval = setInterval(() => {
      setState(prev => ({
        ...prev!,
        elapsedTime: Math.floor((Date.now() - prev!.presentationStartTime!.getTime()) / 1000)
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [state?.isPlaying, state?.presentationStartTime, setState]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!state?.userPreferences.keyboardShortcuts) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default for known shortcuts
      if (HOTKEYS.NEXT_SLIDE.includes(e.key) || 
          HOTKEYS.PREV_SLIDE.includes(e.key) ||
          HOTKEYS.TOGGLE_PLAY.includes(e.key) ||
          e.key === 'f' || e.key === 'F11') {
        e.preventDefault();
      }

      if (HOTKEYS.NEXT_SLIDE.includes(e.key)) {
        nextSlide();
      } else if (HOTKEYS.PREV_SLIDE.includes(e.key)) {
        previousSlide();
      } else if (HOTKEYS.FIRST_SLIDE.includes(e.key)) {
        setState(prev => ({ ...prev!, currentSlide: 0 }));
      } else if (HOTKEYS.LAST_SLIDE.includes(e.key)) {
        setState(prev => ({ ...prev!, currentSlide: props.slides.length - 1 }));
      } else if (HOTKEYS.TOGGLE_PLAY.includes(e.key)) {
        togglePlay();
      } else if (HOTKEYS.FULLSCREEN.includes(e.key)) {
        toggleFullscreen();
      } else if (HOTKEYS.EXIT_FULLSCREEN.includes(e.key) && state.isFullscreen) {
        exitFullscreen();
      } else if (HOTKEYS.TOGGLE_THUMBNAILS.includes(e.key)) {
        toggleThumbnails();
      } else if (HOTKEYS.TOGGLE_NOTES.includes(e.key)) {
        toggleNotes();
      } else if (HOTKEYS.LASER_POINTER.includes(e.key)) {
        toggleLaserPointer();
      } else if (HOTKEYS.BOOKMARK.includes(e.key)) {
        toggleBookmark();
      } else if (HOTKEYS.RESET.includes(e.key)) {
        resetPresentation();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state, props.slides.length]);

  // Auto-hide controls
  useEffect(() => {
    if (!state?.userPreferences.autoHideControls) return;

    const hideControls = () => setIsControlsVisible(false);
    const showControls = () => setIsControlsVisible(true);

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      showControls();
      timeoutId = setTimeout(hideControls, 3000);
    };

    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keydown', resetTimer);

    return () => {
      document.removeEventListener('mousemove', resetTimer);
      document.removeEventListener('keydown', resetTimer);
      clearTimeout(timeoutId);
    };
  }, [state?.userPreferences.autoHideControls]);

  // Canvas integration
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("tambo:showComponent", {
        detail: {
          messageId: componentId,
          component: <PresentationDeck {...props} />
        }
      })
    );
  }, [componentId, props]);

  // Canvas event handling
  useEffect(() => {
    const handleCanvasEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail.componentId === componentId) {
        switch (customEvent.detail.action) {
          case "resize":
            setState(prev => ({
              ...prev!,
              canvasSize: customEvent.detail.size
            }));
            break;
          case "focus":
            setState(prev => ({
              ...prev!,
              isActive: true
            }));
            break;
          case "blur":
            setState(prev => ({
              ...prev!,
              isActive: false,
              isPlaying: false
            }));
            break;
        }
      }
    };

    window.addEventListener("tambo:canvas:interaction", handleCanvasEvent);
    return () => window.removeEventListener("tambo:canvas:interaction", handleCanvasEvent);
  }, [componentId, setState]);

  // Navigation functions
  const nextSlide = useCallback(() => {
    if (!state) return;
    if (state.currentSlide < props.slides.length - 1) {
      setState(prev => ({
        ...prev!,
        currentSlide: prev!.currentSlide + 1
      }));
    }
  }, [state, props.slides.length, setState]);

  const previousSlide = useCallback(() => {
    if (!state) return;
    if (state.currentSlide > 0) {
      setState(prev => ({
        ...prev!,
        currentSlide: prev!.currentSlide - 1
      }));
    }
  }, [state, setState]);

  const goToSlide = useCallback((index: number) => {
    setState(prev => ({
      ...prev!,
      currentSlide: Math.max(0, Math.min(index, props.slides.length - 1))
    }));
  }, [props.slides.length, setState]);

  const togglePlay = useCallback(() => {
    setState(prev => ({
      ...prev!,
      isPlaying: !prev!.isPlaying,
      presentationStartTime: !prev!.isPlaying ? new Date() : prev!.presentationStartTime
    }));
  }, [setState]);

  const toggleFullscreen = useCallback(() => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen();
        setState(prev => ({ ...prev!, isFullscreen: true }));
      } else {
        document.exitFullscreen();
        setState(prev => ({ ...prev!, isFullscreen: false }));
      }
    }
  }, [setState]);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setState(prev => ({ ...prev!, isFullscreen: false }));
    }
  }, [setState]);

  const toggleThumbnails = useCallback(() => {
    setState(prev => ({
      ...prev!,
      showThumbnails: !prev!.showThumbnails
    }));
  }, [setState]);

  const toggleNotes = useCallback(() => {
    setState(prev => ({
      ...prev!,
      showNotes: !prev!.showNotes
    }));
  }, [setState]);

  const toggleLaserPointer = useCallback(() => {
    setState(prev => ({
      ...prev!,
      laserPointerActive: !prev!.laserPointerActive
    }));
  }, [setState]);

  const toggleBookmark = useCallback(() => {
    if (!state) return;
    setState(prev => ({
      ...prev!,
      bookmarkedSlides: prev!.bookmarkedSlides.includes(prev!.currentSlide)
        ? prev!.bookmarkedSlides.filter(i => i !== prev!.currentSlide)
        : [...prev!.bookmarkedSlides, prev!.currentSlide]
    }));
  }, [state, setState]);

  const resetPresentation = useCallback(() => {
    setState(prev => ({
      ...prev!,
      currentSlide: 0,
      isPlaying: false,
      presentationStartTime: null,
      elapsedTime: 0
    }));
  }, [setState]);

  if (!state) {
    return (
      <div className="w-full h-96 bg-slate-900 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-slate-400">Loading presentation...</p>
        </div>
      </div>
    );
  }

  const currentSlideData = props.slides[state.currentSlide];
  const isBookmarked = state.bookmarkedSlides.includes(state.currentSlide);

  return (
    <div 
      ref={containerRef}
      className={`relative bg-slate-950 rounded-lg overflow-hidden ${
        state.isFullscreen ? 'fixed inset-0 z-50' : ''
      }`}
      style={{
        width: state.isFullscreen ? '100vw' : state.canvasSize.width,
        height: state.isFullscreen ? '100dvh' : state.canvasSize.height,
        minWidth: state.isFullscreen ? '100%' : 'min(600px, 100%)',
        minHeight: state.isFullscreen ? '100%' : 'min(400px, 100%)',
      }}
      onPointerMove={handleMouseMove}
    >
      {/* Header */}
      <div className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{props.title}</h3>
            {props.author && (
              <p className="text-sm text-slate-400">by {props.author}</p>
            )}
          </div>
          <ProgressIndicator 
            current={state.currentSlide} 
            total={props.slides.length}
            showTime={state.isPlaying}
            elapsedTime={state.elapsedTime}
          />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex h-[calc(100%-4rem)]">
        {/* Thumbnails sidebar */}
        {state.showThumbnails && (
          <div
            className="w-32 bg-slate-900/50 border-r border-slate-700 p-2 overflow-y-auto"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="space-y-2">
              {props.slides.map((slide, index) => (
                <SlideThumbnail
                  key={slide.id}
                  slide={slide}
                  index={index}
                  isActive={index === state.currentSlide}
                  onClick={() => goToSlide(index)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Main slide area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-6 flex items-center justify-center">
            <SlideDisplay 
              slide={currentSlideData}
              aspectRatio={props.aspectRatio || "16:9"}
              laserPointer={{
                x: state.laserPointerPosition.x,
                y: state.laserPointerPosition.y,
                active: state.laserPointerActive
              }}
            />
          </div>

          {/* Speaker notes */}
          {state.showNotes && currentSlideData.notes && (
            <div className="px-6 pb-4">
              <SpeakerNotes notes={currentSlideData.notes} />
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      {(props.showControls && (isControlsVisible || !state.userPreferences.autoHideControls)) && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <ControlPanel
            currentSlide={state.currentSlide}
            totalSlides={props.slides.length}
            isPlaying={state.isPlaying}
            onPrevious={previousSlide}
            onNext={nextSlide}
            onTogglePlay={togglePlay}
            onFullscreen={toggleFullscreen}
            onToggleThumbnails={toggleThumbnails}
            onToggleNotes={toggleNotes}
            onToggleLaserPointer={toggleLaserPointer}
            onBookmark={toggleBookmark}
            onReset={resetPresentation}
            showThumbnails={state.showThumbnails}
            showNotes={state.showNotes}
            laserPointerActive={state.laserPointerActive}
            isBookmarked={isBookmarked}
          />
        </div>
      )}

      {/* Keyboard shortcuts help */}
      {state.isFullscreen && (
        <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-lg p-3 text-xs text-slate-300">
          <div className="font-semibold mb-2">Shortcuts</div>
          <div className="space-y-1">
            <div>← → Space: Navigate</div>
            <div>Enter: Play/Pause</div>
            <div>F: Fullscreen</div>
            <div>L: Laser pointer</div>
            <div>Esc: Exit</div>
          </div>
        </div>
      )}
    </div>
  );
} 
