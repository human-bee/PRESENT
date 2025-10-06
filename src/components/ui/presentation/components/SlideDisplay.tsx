/* eslint-disable @next/next/no-img-element */
import React from 'react';
import type { Slide } from '../utils';

interface SlideDisplayProps {
  slide: Slide;
  aspectRatio: string;
  laserPointer?: { x: number; y: number; active: boolean };
}

export function SlideDisplay({ slide, aspectRatio, laserPointer }: SlideDisplayProps) {
  const aspectRatioClasses: Record<string, string> = {
    '16:9': 'aspect-video',
    '4:3': 'aspect-[4/3]',
    '16:10': 'aspect-[16/10]',
  };

  return (
    <div
      className={`relative w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-2xl ${aspectRatioClasses[aspectRatio] || 'aspect-video'
        }`}
    >
      {slide.imageUrl ? (
        <img src={slide.imageUrl} alt={slide.title || 'Slide'} className="w-full h-full object-contain" />
      ) : slide.content ? (
        <div className="w-full h-full p-8 overflow-auto prose prose-invert">
          <div dangerouslySetInnerHTML={{ __html: slide.content }} />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-500">
          <div className="text-center">
            <span className="text-lg font-semibold">{slide.title || 'Slide'}</span>
            <p className="text-sm mt-2">No content available</p>
          </div>
        </div>
      )}

      {laserPointer?.active && (
        <div
          className="absolute w-3 h-3 bg-red-500 rounded-full shadow-lg animate-pulse pointer-events-none"
          style={{
            left: `${laserPointer.x}%`,
            top: `${laserPointer.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
    </div>
  );
}
