import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ControlsToolbar,
  OverlayLayer,
  ProgressIndicator,
  SlideDisplay,
  SlideNavigator,
  SpeakerNotes,
} from './components';
import {
  useDeckHotkeys,
  useFullscreen,
  useOverlayState,
  useSlideNavigation,
} from './hooks';
import type { PresentationDeckProps } from './utils';

type PresentationUiState = {
  canvasSize: { width: number; height: number };
  laserPointerActive: boolean;
  laserPointerPosition: { x: number; y: number };
  userPreferences: {
    autoHideControls: boolean;
    keyboardShortcuts: boolean;
    transitionSpeed: 'fast' | 'normal' | 'slow';
  };
  isActive: boolean;
};

export function PresentationDeck(props: PresentationDeckProps) {
  const componentId = useMemo(
    () => `presentation-deck-${props.title.replace(/\s+/g, '-').toLowerCase()}`,
    [props.title],
  );

  const [uiState, setUiState] = useState<PresentationUiState>({
    canvasSize: { width: 800, height: 600 },
    laserPointerActive: false,
    laserPointerPosition: { x: 50, y: 50 },
    userPreferences: {
      autoHideControls: false,
      keyboardShortcuts: true,
      transitionSpeed: 'normal',
    },
    isActive: true,
  });
  const [isControlsVisible, setIsControlsVisible] = useState(true);

  const overlay = useOverlayState({
    defaultNotes: props.showNotes ?? false,
    defaultThumbnails: false,
  });

  const {
    currentSlide,
    totalSlides,
    isPlaying,
    elapsedTime,
    nextSlide,
    previousSlide,
    goToSlide,
    togglePlay,
    setPlaying,
    toggleBookmark,
    reset,
    isBookmarked,
  } = useSlideNavigation({
    slides: props.slides,
    autoAdvance: props.autoAdvance,
    autoAdvanceInterval: props.autoAdvanceInterval,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const { toggleFullscreen: toggleFullscreenInternal } = useFullscreen({
    targetRef: containerRef,
    onChange: overlay.setFullscreen,
  });

  const currentSlideData = props.slides[currentSlide];

  const handleMouseMove = useCallback(
    (event: React.PointerEvent) => {
      if (!uiState.laserPointerActive || !containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      setUiState((prev) => ({
        ...prev,
        laserPointerPosition: {
          x: Math.max(0, Math.min(100, x)),
          y: Math.max(0, Math.min(100, y)),
        },
      }));
    },
    [uiState.laserPointerActive],
  );

  const showComponentAnnouncedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || showComponentAnnouncedRef.current) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent('custom:showComponent', {
        detail: {
          componentId,
        },
      }),
    );
    showComponentAnnouncedRef.current = true;
  }, [componentId]);

  useDeckHotkeys(uiState.userPreferences.keyboardShortcuts, {
    next: nextSlide,
    prev: previousSlide,
    togglePlay,
    toggleNotes: overlay.toggleNotes,
    toggleThumbnails: overlay.toggleThumbnails,
    toggleFullscreen: toggleFullscreenInternal,
    toggleLaserPointer: () =>
      setUiState((prev) => ({ ...prev, laserPointerActive: !prev.laserPointerActive })),
    toggleBookmark,
    reset,
    goToFirst: () => goToSlide(0),
    goToLast: () => goToSlide(props.slides.length - 1),
  });

  useEffect(() => {
    if (!uiState.userPreferences.autoHideControls) {
      return;
    }

    const resetTimer = () => {
      setIsControlsVisible(true);
      window.clearTimeout((resetTimer as unknown as { timeoutId?: number }).timeoutId);
      const timeoutId = window.setTimeout(() => setIsControlsVisible(false), 3000);
      (resetTimer as unknown as { timeoutId?: number }).timeoutId = timeoutId;
    };

    resetTimer();
    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keydown', resetTimer);

    return () => {
      document.removeEventListener('mousemove', resetTimer);
      document.removeEventListener('keydown', resetTimer);
      if ((resetTimer as unknown as { timeoutId?: number }).timeoutId) {
        clearTimeout((resetTimer as unknown as { timeoutId?: number }).timeoutId);
      }
    };
  }, [uiState.userPreferences.autoHideControls]);

  useEffect(() => {
    const handleCanvasEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.componentId !== componentId) {
        return;
      }

      switch (customEvent.detail.action) {
        case 'resize':
          setUiState((prev) => ({ ...prev, canvasSize: customEvent.detail.size }));
          break;
        case 'focus':
          setUiState((prev) => ({ ...prev, isActive: true }));
          break;
        case 'blur':
          setUiState((prev) => ({ ...prev, isActive: false }));
          setPlaying(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener('custom:canvas:interaction', handleCanvasEvent);
    return () => window.removeEventListener('custom:canvas:interaction', handleCanvasEvent);
  }, [componentId, setPlaying]);

  const toggleLaserPointer = useCallback(() => {
    setUiState((prev) => ({ ...prev, laserPointerActive: !prev.laserPointerActive }));
  }, []);

  const containerStyles = overlay.isFullscreen
    ? { width: '100vw', height: '100dvh', minWidth: '100%', minHeight: '100%' }
    : {
        width: uiState.canvasSize.width,
        height: uiState.canvasSize.height,
        minWidth: 'min(600px, 100%)',
        minHeight: 'min(400px, 100%)',
      };

  return (
    <div
      ref={containerRef}
      className={`relative bg-slate-950 rounded-lg overflow-hidden ${overlay.isFullscreen ? 'fixed inset-0 z-50' : ''}`}
      style={containerStyles}
      onPointerMove={handleMouseMove}
    >
      <div className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{props.title}</h3>
            {props.author && <p className="text-sm text-slate-400">by {props.author}</p>}
          </div>
          {props.showProgress && (
            <ProgressIndicator
              current={currentSlide}
              total={totalSlides}
              showTime={isPlaying}
              elapsedTime={elapsedTime}
            />
          )}
        </div>
      </div>

      <div className="flex h-[calc(100%-4rem)]">
        <SlideNavigator
          slides={props.slides}
          currentIndex={currentSlide}
          visible={overlay.thumbnailsOpen}
          onSelect={goToSlide}
        />

        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-6 flex items-center justify-center">
            <SlideDisplay
              slide={currentSlideData}
              aspectRatio={props.aspectRatio || '16:9'}
              laserPointer={{
                x: uiState.laserPointerPosition.x,
                y: uiState.laserPointerPosition.y,
                active: uiState.laserPointerActive,
              }}
            />
          </div>

          {overlay.notesOpen && currentSlideData.notes && (
            <div className="px-6 pb-4">
              <SpeakerNotes notes={currentSlideData.notes} />
            </div>
          )}
        </div>
      </div>

      {props.showControls && (isControlsVisible || !uiState.userPreferences.autoHideControls) && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
          <ControlsToolbar
            currentSlide={currentSlide}
            totalSlides={totalSlides}
            isPlaying={isPlaying}
            onPrevious={previousSlide}
            onNext={nextSlide}
            onTogglePlay={togglePlay}
            onFullscreen={toggleFullscreenInternal}
            onToggleThumbnails={overlay.toggleThumbnails}
            onToggleNotes={overlay.toggleNotes}
            onToggleLaserPointer={toggleLaserPointer}
            onBookmark={toggleBookmark}
            onReset={reset}
            showThumbnails={overlay.thumbnailsOpen}
            showNotes={overlay.notesOpen}
            laserPointerActive={uiState.laserPointerActive}
            isBookmarked={isBookmarked}
          />
        </div>
      )}

      <OverlayLayer showShortcuts={overlay.isFullscreen} />
    </div>
  );
}

export default PresentationDeck;
