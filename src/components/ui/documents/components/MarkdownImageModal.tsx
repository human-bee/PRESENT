/* eslint-disable @next/next/no-img-element */
import React from 'react';
import { X } from 'lucide-react';

interface MarkdownImageModalProps {
  src: string;
  onClose: () => void;
  guards: {
    onMouseDown: (event: React.SyntheticEvent) => void;
    onMouseMove: (event: React.SyntheticEvent) => void;
    onMouseUp: (event: React.SyntheticEvent) => void;
    onTouchStart: (event: React.SyntheticEvent) => void;
    onTouchMove: (event: React.SyntheticEvent) => void;
    onTouchEnd: (event: React.SyntheticEvent) => void;
    onWheel: (event: React.SyntheticEvent) => void;
  };
}

export function MarkdownImageModal({ src, onClose, guards }: MarkdownImageModalProps) {
  return (
    <div
      className="fixed inset-0 z-60 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
      {...guards}
    >
      <div className="relative max-w-full max-h-full">
        <img
          src={src}
          alt="Expanded document media"
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
