'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  componentIcons,
  getAvailableComponents,
  type ComponentIconMapping,
} from '@/lib/component-icons';
import { Button } from '@/components/ui/shared/button';
import { Tooltip, TooltipProvider } from '@/components/ui/shared/tooltip';
import { cn } from '@/lib/utils';
const stopPointerPropagation: React.PointerEventHandler<HTMLButtonElement> = (event) => {
  event.stopPropagation();
};

interface ComponentToolboxProps {
  onComponentCreate: (componentType: string) => void;
}

interface ComponentItemProps {
  componentName: string;
  iconMapping: ComponentIconMapping;
  onDragStart: (componentType: string) => void;
  onClick: (componentType: string) => void;
  isDark: boolean;
}

const ComponentItem: React.FC<ComponentItemProps> = ({
  componentName,
  iconMapping,
  onDragStart,
  onClick,
  isDark,
}) => {
  const IconComponent = iconMapping.icon;

  // Deterministic pastel hover based on name so the palette feels lively but consistent
  // Light theme background tints
  const pastelHoverClassesLight = [
    '!hover:bg-rose-100',
    '!hover:bg-pink-100',
    '!hover:bg-fuchsia-100',
    '!hover:bg-purple-100',
    '!hover:bg-violet-100',
    '!hover:bg-indigo-100',
    '!hover:bg-sky-100',
    '!hover:bg-cyan-100',
    '!hover:bg-teal-100',
    '!hover:bg-emerald-100',
    '!hover:bg-lime-100',
    '!hover:bg-amber-100',
    '!hover:bg-orange-100',
  ] as const;

  // Dark theme translucent tints (so icons remain visible on dark base)
  const pastelHoverClassesDark = [
    'dark:!hover:bg-rose-400/25',
    'dark:!hover:bg-pink-400/25',
    'dark:!hover:bg-fuchsia-400/25',
    'dark:!hover:bg-purple-400/25',
    'dark:!hover:bg-violet-400/25',
    'dark:!hover:bg-indigo-400/25',
    'dark:!hover:bg-sky-400/25',
    'dark:!hover:bg-cyan-400/25',
    'dark:!hover:bg-teal-400/25',
    'dark:!hover:bg-emerald-400/25',
    'dark:!hover:bg-lime-400/25',
    'dark:!hover:bg-amber-400/25',
    'dark:!hover:bg-orange-400/25',
  ] as const;

  const pastelBorderHoverClasses = [
    'hover:border-rose-300',
    'hover:border-pink-300',
    'hover:border-fuchsia-300',
    'hover:border-purple-300',
    'hover:border-violet-300',
    'hover:border-indigo-300',
    'hover:border-sky-300',
    'hover:border-cyan-300',
    'hover:border-teal-300',
    'hover:border-emerald-300',
    'hover:border-lime-300',
    'hover:border-amber-300',
    'hover:border-orange-300',
  ] as const;

  const pastelBorderHoverClassesDark = [
    'dark:hover:border-rose-400/60',
    'dark:hover:border-pink-400/60',
    'dark:hover:border-fuchsia-400/60',
    'dark:hover:border-purple-400/60',
    'dark:hover:border-violet-400/60',
    'dark:hover:border-indigo-400/60',
    'dark:hover:border-sky-400/60',
    'dark:hover:border-cyan-400/60',
    'dark:hover:border-teal-400/60',
    'dark:hover:border-emerald-400/60',
    'dark:hover:border-lime-400/60',
    'dark:hover:border-amber-400/60',
    'dark:hover:border-orange-400/60',
  ] as const;


  const colorIndex = (() => {
    let hash = 0;
    for (let i = 0; i < componentName.length; i++) hash = (hash + componentName.charCodeAt(i)) % 2147483647;
    return Math.abs(hash) % pastelHoverClassesLight.length;
  })();
  const hoverClassLight = pastelHoverClassesLight[colorIndex];
  const hoverClassDark = pastelHoverClassesDark[colorIndex];
  const borderHoverClass = pastelBorderHoverClasses[colorIndex];
  const borderHoverClassDark = pastelBorderHoverClassesDark[colorIndex];

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip content={componentName} side="left" className="duration-300">
        <Button
          variant="outline"
          size="icon"
          draggable
          aria-label={componentName}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/custom-component', componentName);
            onDragStart(componentName);
          }}
          onClick={() => onClick(componentName)}
          onPointerDown={stopPointerPropagation}
          className={cn(
            'group h-9 w-9 select-none p-0 rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors',
            isDark ? 'bg-zinc-900 text-white' : 'bg-white text-black',
            isDark ? hoverClassDark : hoverClassLight,
            isDark ? borderHoverClassDark : borderHoverClass,
            isDark ? '!hover:text-white' : '!hover:text-black',
          )}
        >
          <IconComponent className={cn('h-4 w-4 text-current')} />
        </Button>
      </Tooltip>
    </TooltipProvider>
  );
};

export const ComponentToolbox: React.FC<ComponentToolboxProps> = ({ onComponentCreate }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => {
      const styles = getComputedStyle(el);
      const panel = styles.getPropertyValue('--color-panel') || 'rgb(255,255,255)';
      // Parse rgb(a) to numbers and estimate luminance
      const match = panel.match(/rgba?\(([^)]+)\)/);
      let r = 255, g = 255, b = 255;
      if (match) {
        const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
        if (parts.length >= 3) {
          [r, g, b] = parts as any;
        }
      }
      const sr = r / 255, sg = g / 255, sb = b / 255;
      const lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
      setIsDark(lum < 0.5);
    };
    compute();
    const obs = new MutationObserver(compute);
    // Watch attribute changes up the tree (theme flips adjust CSS vars)
    let parent: HTMLElement | null = el.parentElement;
    const observed: HTMLElement[] = [];
    while (parent) {
      obs.observe(parent, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      observed.push(parent);
      parent = parent.parentElement;
    }
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('resize', compute);
      obs.disconnect();
    };
  }, []);
  const componentNames = useMemo(() => getAvailableComponents(), []);

  const handleDragStart = () => {
    // No-op
  };
  const handleComponentClick = (componentType: string) => {
    // Special case: Mermaid (stream) creates a TLDraw shape, not a React component
    if (componentType === 'Mermaid (stream)') {
      try {
        window.dispatchEvent(new CustomEvent('tldraw:create_mermaid_stream', { detail: {} }));
        return;
      } catch {}
    }
    onComponentCreate(componentType);
  };

  return (
    <div ref={rootRef} className="h-full w-full overflow-auto bg-[var(--color-panel)] p-2">
      <div className="flex flex-col items-center gap-1.5">
        {componentNames.map((componentName) => {
          const iconMapping = componentIcons[componentName];
          return (
            <ComponentItem
              key={componentName}
              componentName={componentName}
              iconMapping={iconMapping}
              onDragStart={handleDragStart}
              onClick={handleComponentClick}
              isDark={isDark}
            />
          );
        })}
      </div>
    </div>
  );
};
