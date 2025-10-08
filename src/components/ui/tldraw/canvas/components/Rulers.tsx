"use client";

import React, { type CSSProperties } from 'react';

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  spacing: number;
  origin: number;
  length: number;
}

function Ruler({ orientation, spacing, origin, length }: RulerProps) {
  const ticks: React.ReactElement[] = [];
  const count = Math.ceil(length / spacing);
  for (let i = 0; i <= count; i += 1) {
    const position = i * spacing - (origin % spacing);
    const tickStyle: CSSProperties =
      orientation === 'horizontal'
        ? {
            position: 'absolute',
            left: `${position}px`,
            top: 0,
            width: 1,
            height: '100%',
            background: 'rgba(55,65,81,0.4)',
          }
        : {
            position: 'absolute',
            top: `${position}px`,
            left: 0,
            width: '100%',
            height: 1,
            background: 'rgba(55,65,81,0.4)',
          };
    ticks.push(<div key={`${orientation}-${i}`} style={tickStyle} />);
  }

  const wrapperStyle: CSSProperties =
    orientation === 'horizontal'
      ? {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: 24,
          background: 'rgba(17,24,39,0.85)',
        }
      : {
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: 24,
          background: 'rgba(17,24,39,0.85)',
        };

  return <div style={wrapperStyle}>{ticks}</div>;
}

interface RulersProps {
  showHorizontal: boolean;
  showVertical: boolean;
  majorSpacing: number;
  origin: { x: number; y: number };
}

export function Rulers({ showHorizontal, showVertical, majorSpacing, origin }: RulersProps) {
  const horizontalLength = typeof window !== 'undefined' ? window.innerWidth : 0;
  const verticalLength = typeof window !== 'undefined' ? window.innerHeight : 0;

  return (
    <>
      {showHorizontal && (
        <Ruler orientation="horizontal" spacing={majorSpacing} origin={origin.x} length={horizontalLength} />
      )}
      {showVertical && (
        <Ruler orientation="vertical" spacing={majorSpacing} origin={origin.y} length={verticalLength} />
      )}
    </>
  );
}
