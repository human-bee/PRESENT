/**
 * Component tools for the LiveKit agent worker
 * 
 * This file defines OpenAI function tools without importing React components
 * to avoid Node.js compatibility issues.
 */

import { z } from 'zod';

export const componentTools = [
  {
    type: 'function',
    function: {
      name: 'create_weatherforecast',
      description: 'Display weather forecast data with visuals. Requires JSON weather data in a specific format.',
      parameters: {
        location: z.string().optional().describe('Location for weather forecast'),
        periods: z.array(z.any()).optional().describe('Weather forecast periods'),
        tideData: z.any().optional().describe('Tide information'),
        moonPhase: z.any().optional().describe('Moon phase data'),
        alerts: z.array(z.any()).optional().describe('Weather alerts'),
      },
      execute: async (params: any) => ({
        componentType: 'WeatherForecast',
        initialProps: params
      })
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_retrotimerenhanced',
      description: 'An enhanced retro-styled countdown timer with AI update capabilities.',
      parameters: {
        initialMinutes: z.number().default(5).describe('Initial timer duration in minutes'),
        initialSeconds: z.number().default(0).describe('Initial timer duration in seconds'),
        title: z.string().optional().describe('Timer title/label'),
        autoStart: z.boolean().default(false).describe('Whether to auto-start the timer'),
      },
      execute: async (params: any) => ({
        componentType: 'RetroTimerEnhanced',
        initialProps: params
      })
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_youtubeembed',
      description: 'Use this to embed a YouTube video. Requires a video ID and optional start time in seconds.',
      parameters: {
        videoId: z.string().describe('YouTube video ID'),
        title: z.string().optional().describe('Video title'),
        startTime: z.number().default(0).describe('Start time in seconds'),
      },
      execute: async (params: any) => ({
        componentType: 'YoutubeEmbed',
        initialProps: params
      })
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_actionitemtracker',
      description: 'A comprehensive action item management system that tracks tasks, assignments, due dates, and progress.',
      parameters: {
        title: z.string().default('Action Items').describe('Title of the action item list'),
        initialItems: z.array(z.any()).optional().describe('Initial action items'),
      },
      execute: async (params: any) => ({
        componentType: 'ActionItemTracker',
        initialProps: params
      })
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_linearkanbanboard',
      description: 'A comprehensive Linear project management kanban board with drag-and-drop functionality.',
      parameters: {
        title: z.string().default('Linear Kanban Board').describe('Board title'),
        teams: z.array(z.any()).optional().describe('Linear teams available'),
        statuses: z.array(z.any()).optional().describe('Status definitions'),
        issues: z.array(z.any()).optional().describe('Initial issues'),
      },
      execute: async (params: any) => ({
        componentType: 'LinearKanbanBoard',
        initialProps: params
      })
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_livecaptions',
      description: 'A real-time live captions component that displays speech transcriptions.',
      parameters: {
        theme: z.string().default('grid').describe('Canvas theme'),
        exportFormat: z.string().default('txt').describe('Export format'),
      },
      execute: async (params: any) => ({
        componentType: 'LiveCaptions',
        initialProps: params
      })
    }
  }
];