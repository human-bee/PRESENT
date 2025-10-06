import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ControlsToolbar,
  OverlayLayer,
  ProgressIndicator,
  SlideDisplay,
  SlideNavigator,
  SpeakerNotes,
} from './components';
import { useSlideNavigation } from './hooks';
import type { PresentationDeckProps } from './utils';

interface PresentationUiState {
  isFullscreen: boolean;
  showThumbnails: boolean;
  showNotes: boolean;
  canvasSize: { width: number; height: number };
  laserPointerActive: boolean;
  laserPointerPosition: { x: number; y: number };
  userPreferences: {
    autoHideControls: boolean;
    keyboardShortcuts: boolean;
    transitionSpeed: 'fast' | 'normal' | 'slow';
  };
  isActive: boolean;
}

export function PresentationDeck(props: PresentationDeckProps) {
  const componentId = useMemo(
    () => `presentation-deck-${props.title.replace(/\s+/g, '-').toLowerCase()}`,
    [props.title],
  );

  const [uiState, setUiState] = useState<PresentationUiState>({
    isFullscreen: false,
    showThumbnails: false,
    showNotes: props.showNotes ?? false,
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [isControlsVisible, setIsControlsVisible] = useState(true);

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

  useEffect(() => {
    if (!uiState.userPreferences.keyboardShortcuts) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'Space', 'Enter', 'ArrowLeft'].includes(event.key)) {
        event.preventDefault();
      }

      switch (event.key) {
        case 'ArrowRight':
        case 'n':
        case 'j':
        case ' ': {
          nextSlide();
          break;
        }
        case 'ArrowLeft':
        case 'p':
        case 'k': {
          previousSlide();
          break;
        }
        case 'Enter': {
          togglePlay();
          break;
        }
        case 'f':
        case 'F11': {
          if (containerRef.current) {
            containerRef.current.requestFullscreen().catch(() => undefined);
            setUiState((prev) => ({ ...prev, isFullscreen: true }));
          }
          break;
        }
        case 'Escape': {
          if (document.fullscreenElement) {
            void document.exitFullscreen();
            setUiState((prev) => ({ ...prev, isFullscreen: false }));
          }
          break;
        }
        case 't': {
          setUiState((prev) => ({ ...prev, showThumbnails: !prev.showThumbnails }));
          break;
        }
        case 's': {
          setUiState((prev) => ({ ...prev, showNotes: !prev.showNotes }));
          break;
        }
        case 'l': {
          setUiState((prev) => ({ ...prev, laserPointerActive: !prev.laserPointerActive }));
          break;
        }
        case 'b': {
          toggleBookmark();
          break;
        }
        case 'r': {
          reset();
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, previousSlide, reset, toggleBookmark, togglePlay, uiState.userPreferences.keyboardShortcuts]);

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
    window.dispatchEvent(
      new CustomEvent('custom:showComponent', {
        detail: {
          messageId: componentId,
          component: <PresentationDeck {...props} />,
        },
      }),
    );
  }, [componentId, props]);

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

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) {
      return;
    }

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => undefined);
      setUiState((prev) => ({ ...prev, isFullscreen: true }));
      return;
    }

    document.exitFullscreen().catch(() => undefined);
    setUiState((prev) => ({ ...prev, isFullscreen: false }));
  }, []);

  const toggleThumbnails = useCallback(() => {
    setUiState((prev) => ({ ...prev, showThumbnails: !prev.showThumbnails }));
  }, []);

  const toggleNotes = useCallback(() => {
    setUiState((prev) => ({ ...prev, showNotes: !prev.showNotes }));
  }, []);

  const toggleLaserPointer = useCallback(() => {
    setUiState((prev) => ({ ...prev, laserPointerActive: !prev.laserPointerActive }));
  }, []);

  const containerStyles = uiState.isFullscreen
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
      className={`relative bg-slate-950 rounded-lg overflow-hidden ${uiState.isFullscreen ? 'fixed inset-0 z-50' : ''}`}
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
            <ProgressIndicator current={currentSlide} total={totalSlides} showTime={isPlaying} elapsedTime={elapsedTime} />
          )}
        </div>
      </div>

      <div className="flex h-[calc(100%-4rem)]">
        <SlideNavigator
          slides={props.slides}
          currentIndex={currentSlide}
          visible={uiState.showThumbnails}
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

          {uiState.showNotes && currentSlideData.notes && (
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
            onFullscreen={toggleFullscreen}
            onToggleThumbnails={toggleThumbnails}
            onToggleNotes={toggleNotes}
            onToggleLaserPointer={toggleLaserPointer}
            onBookmark={toggleBookmark}
            onReset={reset}
            showThumbnails={uiState.showThumbnails}
            showNotes={uiState.showNotes}
            laserPointerActive={uiState.laserPointerActive}
            isBookmarked={isBookmarked}
          />
        </div>
      )}

      <OverlayLayer showShortcuts={uiState.isFullscreen} />
    </div>
  );
}

export default PresentationDeck;
