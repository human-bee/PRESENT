"use client";

interface GridLayerProps {
  visible: boolean;
  spacing: { major: number; minor: number };
}

export function GridLayer({ visible, spacing }: GridLayerProps) {
  if (!visible) return null;

  const backgroundSize = `${spacing.minor}px ${spacing.minor}px`;
  const majorBackgroundSize = `${spacing.major}px ${spacing.major}px`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(var(--grid-minor-color, rgba(0,0,0,0.04)) 1px, transparent 1px), linear-gradient(90deg, var(--grid-minor-color, rgba(0,0,0,0.04)) 1px, transparent 1px), linear-gradient(var(--grid-major-color, rgba(0,0,0,0.08)) 1px, transparent 1px), linear-gradient(90deg, var(--grid-major-color, rgba(0,0,0,0.08)) 1px, transparent 1px)` ,
        backgroundSize: `${backgroundSize}, ${backgroundSize}, ${majorBackgroundSize}, ${majorBackgroundSize}`,
      }}
    />
  );
}

