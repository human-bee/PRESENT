import React from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Grid3X3,
  Maximize,
  MousePointer,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';

interface ControlsToolbarProps {
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
}

export function ControlsToolbar({
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
  isBookmarked,
}: ControlsToolbarProps) {
  return (
    <div className="flex items-center justify-between bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-lg px-4 py-2">
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={currentSlide === 0}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Previous slide (←)"
        >
          <ChevronLeft size={20} />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
          title={isPlaying ? 'Pause (Enter)' : 'Play (Enter)'}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={currentSlide === totalSlides - 1}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Next slide (→)"
        >
          <ChevronRight size={20} />
        </button>

        <button
          type="button"
          onClick={onReset}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
          title="Reset to first slide (R)"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onBookmark}
          className={`p-2 rounded transition-colors ${isBookmarked ? 'text-yellow-400 hover:text-yellow-300' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}
          title="Bookmark slide (B)"
        >
          <Bookmark size={16} />
        </button>

        <button
          type="button"
          onClick={onToggleLaserPointer}
          className={`p-2 rounded transition-colors ${laserPointerActive ? 'text-red-400 hover:text-red-300 bg-red-400/10' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}
          title="Laser pointer (L)"
        >
          <MousePointer size={16} />
        </button>

        <button
          type="button"
          onClick={onToggleThumbnails}
          className={`p-2 rounded transition-colors ${showThumbnails ? 'text-blue-400 hover:text-blue-300 bg-blue-400/10' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}
          title="Toggle thumbnails (T)"
        >
          <Grid3X3 size={16} />
        </button>

        <button
          type="button"
          onClick={onToggleNotes}
          className={`p-2 rounded transition-colors ${showNotes ? 'text-green-400 hover:text-green-300 bg-green-400/10' : 'text-slate-300 hover:text-white hover:bg-slate-700'}`}
          title="Toggle notes (S)"
        >
          {showNotes ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>

        <button
          type="button"
          onClick={onFullscreen}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
          title="Fullscreen (F)"
        >
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
