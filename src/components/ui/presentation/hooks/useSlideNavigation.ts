import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Slide } from '../utils';

interface UseSlideNavigationOptions {
  slides: Slide[];
  autoAdvance?: boolean;
  autoAdvanceInterval?: number;
}

interface SlideNavigationState {
  currentSlide: number;
  isPlaying: boolean;
  presentationStartTime: Date | null;
  elapsedTime: number;
  bookmarkedSlides: number[];
}

const defaultState: SlideNavigationState = {
  currentSlide: 0,
  isPlaying: false,
  presentationStartTime: null,
  elapsedTime: 0,
  bookmarkedSlides: [],
};

const clampIndex = (value: number, total: number) => Math.max(0, Math.min(value, Math.max(total - 1, 0)));

export interface SlideNavigationApi {
  currentSlide: number;
  totalSlides: number;
  isPlaying: boolean;
  elapsedTime: number;
  isFirstSlide: boolean;
  isLastSlide: boolean;
  isBookmarked: boolean;
  bookmarkedSlides: number[];
  nextSlide: () => void;
  previousSlide: () => void;
  goToSlide: (index: number) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  toggleBookmark: () => void;
  reset: () => void;
}

export function useSlideNavigation(options: UseSlideNavigationOptions): SlideNavigationApi {
  const { slides, autoAdvance = false, autoAdvanceInterval = 30 } = options;
  const totalSlides = slides.length;
  const [state, setState] = useState<SlideNavigationState>(() => ({ ...defaultState }));

  useEffect(() => {
    setState((prev) => ({ ...prev, currentSlide: clampIndex(prev.currentSlide, totalSlides) }));
  }, [totalSlides]);

  useEffect(() => {
    if (!autoAdvance || !state.isPlaying || totalSlides <= 1) return;
    const intervalMs = Math.max(1, autoAdvanceInterval) * 1000;
    const timer = setInterval(() => {
      setState((prev) => {
        const nextIndex = clampIndex(prev.currentSlide + 1, totalSlides);
        return nextIndex === prev.currentSlide
          ? { ...prev, isPlaying: false }
          : { ...prev, currentSlide: nextIndex };
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoAdvance, autoAdvanceInterval, state.isPlaying, totalSlides]);

  useEffect(() => {
    if (!state.isPlaying || !state.presentationStartTime) return;
    const timer = setInterval(() => {
      setState((prev) => ({
        ...prev,
        elapsedTime: Math.floor((Date.now() - (prev.presentationStartTime?.getTime() ?? Date.now())) / 1000),
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, [state.isPlaying, state.presentationStartTime]);

  const goToSlide = useCallback(
    (index: number) => setState((prev) => ({ ...prev, currentSlide: clampIndex(index, totalSlides) })),
    [totalSlides],
  );

  const nextSlide = useCallback(() => {
    setState((prev) => ({ ...prev, currentSlide: clampIndex(prev.currentSlide + 1, totalSlides) }));
  }, [totalSlides]);

  const previousSlide = useCallback(() => {
    setState((prev) => ({ ...prev, currentSlide: clampIndex(prev.currentSlide - 1, totalSlides) }));
  }, [totalSlides]);

  const ensureStartTime = (prev: SlideNavigationState, playing: boolean) =>
    playing ? prev.presentationStartTime ?? new Date() : prev.presentationStartTime;

  const setPlaying = useCallback((playing: boolean) => {
    setState((prev) => ({
      ...prev,
      isPlaying: playing,
      presentationStartTime: ensureStartTime(prev, playing),
    }));
  }, []);

  const togglePlay = useCallback(() => {
    setState((prev) => {
      const nextPlaying = !prev.isPlaying;
      return {
        ...prev,
        isPlaying: nextPlaying,
        presentationStartTime: ensureStartTime(prev, nextPlaying),
      };
    });
  }, []);

  const toggleBookmark = useCallback(() => {
    setState((prev) => {
      const isAlreadyBookmarked = prev.bookmarkedSlides.includes(prev.currentSlide);
      const bookmarkedSlides = isAlreadyBookmarked
        ? prev.bookmarkedSlides.filter((index) => index !== prev.currentSlide)
        : [...prev.bookmarkedSlides, prev.currentSlide];
      return { ...prev, bookmarkedSlides };
    });
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({ ...prev, currentSlide: 0, isPlaying: false, presentationStartTime: null, elapsedTime: 0 }));
  }, []);

  const isBookmarked = useMemo(
    () => state.bookmarkedSlides.includes(state.currentSlide),
    [state.bookmarkedSlides, state.currentSlide],
  );

  return {
    currentSlide: state.currentSlide,
    totalSlides,
    isPlaying: state.isPlaying,
    elapsedTime: state.elapsedTime,
    isFirstSlide: state.currentSlide === 0,
    isLastSlide: state.currentSlide === Math.max(totalSlides - 1, 0),
    isBookmarked,
    bookmarkedSlides: state.bookmarkedSlides,
    nextSlide,
    previousSlide,
    goToSlide,
    togglePlay,
    setPlaying,
    toggleBookmark,
    reset,
  };
}
