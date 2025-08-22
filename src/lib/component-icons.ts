/**
 * @file component-icons.ts
 * @description Icon mappings for Tambo components used in the Component Toolbox
 */

import { 
  FileText, 
  Timer, 
  Cloud, 
  Youtube, 
  Image, 
  CheckSquare, 
  Search, 
  Video, 
  Users, 
  Captions, 
  Kanban, 
  HelpCircle,
  Trophy,
  type LucideIcon
} from "lucide-react";

export interface ComponentIconMapping {
  icon: LucideIcon;
  category: 'Essentials' | 'Media' | 'Productivity' | 'Collaboration';
  description: string;
}

/**
 * Icon mappings for all available Tambo components
 * Maps component names from tambo.ts to their corresponding Lucide icons
 */
export const componentIcons: Record<string, ComponentIconMapping> = {
  // Essentials
  'OnboardingGuide': {
    icon: HelpCircle,
    category: 'Essentials',
    description: 'Interactive guide for new users'
  },
  'RetroTimerEnhanced': {
    icon: Timer,
    category: 'Essentials', 
    description: 'Countdown timer with presets'
  },
  'DocumentEditor': {
    icon: FileText,
    category: 'Essentials',
    description: 'Collaborative document editor'
  },

  // Media
  'YoutubeEmbed': {
    icon: Youtube,
    category: 'Media',
    description: 'Embed YouTube videos'
  },
  'AIImageGenerator': {
    icon: Image,
    category: 'Media', 
    description: 'Generate AI images from text'
  },

  // Productivity
  'WeatherForecast': {
    icon: Cloud,
    category: 'Productivity',
    description: 'Weather forecast display'
  },
  'ActionItemTracker': {
    icon: CheckSquare,
    category: 'Productivity',
    description: 'Track tasks and action items'
  },
  'ResearchPanel': {
    icon: Search,
    category: 'Productivity',
    description: 'Display research findings'
  },
  'DebateScorecard': {
    icon: Trophy,
    category: 'Collaboration',
    description: 'Live debate scorecard (boxing/Game Boy aesthetic)'
  },
  'LinearKanbanBoard': {
    icon: Kanban,
    category: 'Productivity',
    description: 'Project management board'
  },

  // Collaboration
  'LivekitRoomConnector': {
    icon: Video,
    category: 'Collaboration',
    description: 'Connect to video rooms'
  },
  'LivekitParticipantTile': {
    icon: Users,
    category: 'Collaboration', 
    description: 'Individual participant video'
  },
  'LiveCaptions': {
    icon: Captions,
    category: 'Collaboration',
    description: 'Live speech transcription'
  }
};

/**
 * Get available categories for component organization
 */
export const getCategories = (): string[] => {
  return Array.from(new Set(Object.values(componentIcons).map(item => item.category)));
};

/**
 * Get components by category
 */
export const getComponentsByCategory = (category: string): string[] => {
  return Object.keys(componentIcons).filter(
    componentName => componentIcons[componentName].category === category
  );
};

/**
 * Get all component names that have icon mappings
 */
export const getAvailableComponents = (): string[] => {
  return Object.keys(componentIcons);
};