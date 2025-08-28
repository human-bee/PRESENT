'use client';

import React, { useMemo } from 'react';
import {
  componentIcons,
  getCategories,
  getComponentsByCategory,
  type ComponentIconMapping,
} from '@/lib/component-icons';
import { stopEventPropagation } from 'tldraw';

interface ComponentToolboxProps {
  onComponentCreate: (componentType: string) => void;
}

interface ComponentItemProps {
  componentName: string;
  iconMapping: ComponentIconMapping;
  onDragStart: (componentType: string) => void;
  onClick: (componentType: string) => void;
}

const ComponentItem: React.FC<ComponentItemProps> = ({
  componentName,
  iconMapping,
  onDragStart,
  onClick,
}) => {
  const IconComponent = iconMapping.icon;

  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/tambo-component', componentName);
        onDragStart(componentName);
      }}
      onClick={() => onClick(componentName)}
      onPointerDown={stopEventPropagation}
      title={`${componentName}: ${iconMapping.description}`}
      style={{
        border: '1.5px solid var(--color-accent)',
        borderRadius: 6,
        background: 'var(--color-panel)',
        margin: 2,
        padding: 0,
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 4px 0 rgba(0,0,0,0.06)',
        cursor: 'pointer',
      }}
    >
      <IconComponent size={20} style={{ color: 'var(--color-accent)' }} />
    </button>
  );
};

export const ComponentToolbox: React.FC<ComponentToolboxProps> = ({ onComponentCreate }) => {
  const searchQuery = '';
  const categories = useMemo(() => getCategories(), []);

  const handleDragStart = () => {
    // No-op
  };
  const handleComponentClick = (componentType: string) => {
    onComponentCreate(componentType);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: '2px',
        padding: '8px',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--color-panel)',
      }}
    >
      {categories.map((category) => {
        const categoryComponents = getComponentsByCategory(category);
        const filteredComponents = searchQuery.trim()
          ? categoryComponents.filter((name) => {
              const iconMapping = componentIcons[name];
              const query = searchQuery.toLowerCase();
              return (
                name.toLowerCase().includes(query) ||
                iconMapping.description.toLowerCase().includes(query)
              );
            })
          : categoryComponents;
        return filteredComponents.map((componentName) => {
          const iconMapping = componentIcons[componentName];
          return (
            <ComponentItem
              key={componentName}
              componentName={componentName}
              iconMapping={iconMapping}
              onDragStart={handleDragStart}
              onClick={handleComponentClick}
            />
          );
        });
      })}
    </div>
  );
};
