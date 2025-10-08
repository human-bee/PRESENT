/* eslint-disable @next/next/no-img-element */
import React from 'react';
import type { Slide } from '../utils';
import { FileText } from 'lucide-react';

interface SlideNavigatorProps {
  slides: Slide[];
  currentIndex: number;
  visible: boolean;
  onSelect: (index: number) => void;
}

export function SlideNavigator({ slides, currentIndex, visible, onSelect }: SlideNavigatorProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="w-32 bg-slate-900/50 border-r border-slate-700 p-2 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="space-y-2">
        {slides.map((slide, index) => {
          const isActive = index === currentIndex;
          return (
            <button
              type="button"
              key={slide.id}
              onClick={() => onSelect(index)}
              className={`relative w-20 h-14 rounded border-2 transition-all duration-200 hover:scale-105 ${isActive ? 'border-blue-400 bg-blue-400/10' : 'border-slate-600 hover:border-slate-400'}`}
            >
              {slide.thumbnailUrl || slide.imageUrl ? (
                <img src={slide.thumbnailUrl || slide.imageUrl} alt={`Slide ${index + 1}`} className="w-full h-full object-cover rounded" />
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
        })}
      </div>
    </div>
  );
}
