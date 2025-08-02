"use client";

import React, { useState, useMemo } from 'react';
import { Search, X, Palette } from 'lucide-react';
import { componentIcons, getCategories, getComponentsByCategory, type ComponentIconMapping } from '@/lib/component-icons';
import { components } from '@/lib/tambo';
import { nanoid } from 'nanoid';

interface ComponentToolboxProps {
  isOpen: boolean;
  onToggle: () => void;
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
  onClick 
}) => {
  const IconComponent = iconMapping.icon;
  
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 cursor-pointer transition-colors group"
      draggable
      onDragStart={() => onDragStart(componentName)}
      onClick={() => onClick(componentName)}
      title={`${componentName}: ${iconMapping.description}`}
    >
      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
        <IconComponent className="w-4 h-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">
          {componentName}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {iconMapping.description}
        </div>
      </div>
    </div>
  );
};

interface CategorySectionProps {
  category: string;
  componentNames: string[];
  searchQuery: string;
  onDragStart: (componentType: string) => void;
  onClick: (componentType: string) => void;
}

const CategorySection: React.FC<CategorySectionProps> = ({ 
  category, 
  componentNames, 
  searchQuery,
  onDragStart,
  onClick 
}) => {
  // Filter components based on search query
  const filteredComponents = useMemo(() => {
    if (!searchQuery.trim()) return componentNames;
    
    const query = searchQuery.toLowerCase();
    return componentNames.filter(name => {
      const iconMapping = componentIcons[name];
      return (
        name.toLowerCase().includes(query) ||
        iconMapping.description.toLowerCase().includes(query)
      );
    });
  }, [componentNames, searchQuery]);

  if (filteredComponents.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        {category}
      </h3>
      <div className="space-y-2">
        {filteredComponents.map(componentName => {
          const iconMapping = componentIcons[componentName];
          return (
            <ComponentItem
              key={componentName}
              componentName={componentName}
              iconMapping={iconMapping}
              onDragStart={onDragStart}
              onClick={onClick}
            />
          );
        })}
      </div>
    </div>
  );
};

export const ComponentToolbox: React.FC<ComponentToolboxProps> = ({
  isOpen,
  onToggle,
  onComponentCreate
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedComponent, setDraggedComponent] = useState<string | null>(null);

  const categories = useMemo(() => getCategories(), []);

  const handleDragStart = (componentType: string) => {
    setDraggedComponent(componentType);
  };

  const handleDragEnd = () => {
    setDraggedComponent(null);
  };

  const handleComponentClick = (componentType: string) => {
    onComponentCreate(componentType);
    // Optionally close toolbox after creating component
    // onToggle();
  };

  // Get total component count for display
  const totalComponents = Object.keys(componentIcons).length;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-20 z-40"
        onClick={onToggle}
      />
      
      {/* Toolbox Sidebar */}
      <div className="fixed left-0 top-0 bottom-0 w-80 bg-gray-50 border-r border-gray-200 z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <Palette className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Components</h2>
              <p className="text-xs text-gray-500">{totalComponents} available</p>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
            title="Close component toolbox"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search components..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Component List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs text-gray-500 mb-4 bg-blue-50 p-2 rounded-lg">
            💡 <strong>Tip:</strong> Drag components to canvas or click to create at center
          </div>
          
          {categories.map(category => {
            const categoryComponents = getComponentsByCategory(category);
            return (
              <CategorySection
                key={category}
                category={category}
                componentNames={categoryComponents}
                searchQuery={searchQuery}
                onDragStart={handleDragStart}
                onClick={handleComponentClick}
              />
            );
          })}

          {/* No results message */}
          {searchQuery.trim() && categories.every(category => {
            const categoryComponents = getComponentsByCategory(category);
            const query = searchQuery.toLowerCase();
            return !categoryComponents.some(name => {
              const iconMapping = componentIcons[name];
              return (
                name.toLowerCase().includes(query) ||
                iconMapping.description.toLowerCase().includes(query)
              );
            });
          }) && (
            <div className="text-center py-8 text-gray-500">
              <Search className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No components match "{searchQuery}"</p>
              <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="text-xs text-gray-500 text-center">
            <p>Drag & drop or click to create</p>
            <p className="text-gray-400">Powered by Tambo Components</p>
          </div>
        </div>
      </div>

      {/* Drag overlay feedback */}
      {draggedComponent && (
        <div 
          className="fixed inset-0 pointer-events-none z-60"
          onDragEnd={handleDragEnd}
        >
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
            Creating {draggedComponent}...
          </div>
        </div>
      )}
    </>
  );
};