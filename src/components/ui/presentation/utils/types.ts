import { z } from 'zod';

export const slideSchema = z.object({
  id: z.string().describe('Unique slide identifier'),
  title: z.string().optional().describe('Slide title'),
  content: z.string().optional().describe('Slide content (HTML, Markdown, or text)'),
  imageUrl: z.string().optional().describe('Direct image URL for slide'),
  thumbnailUrl: z.string().optional().describe('Thumbnail image URL'),
  notes: z.string().optional().describe('Speaker notes for this slide'),
  duration: z.number().optional().describe('Suggested duration for this slide in seconds'),
  transition: z.enum(['fade', 'slide', 'zoom', 'flip']).optional().default('fade'),
});

export const presentationDeckSchema = z.object({
  title: z.string().describe('Presentation title'),
  slides: z.array(slideSchema).describe('Array of slides in the presentation'),
  sourceType: z
    .enum(['powerpoint', 'google-slides', 'pdf', 'images', 'html', 'markdown'])
    .optional()
    .default('images')
    .describe('Type of presentation source'),
  sourceUrl: z.string().optional().describe('URL to original presentation (Google Slides, etc.)'),
  aspectRatio: z.enum(['16:9', '4:3', '16:10']).optional().default('16:9'),
  theme: z.enum(['dark', 'light', 'auto']).optional().default('dark'),
  autoAdvance: z.boolean().optional().default(false).describe('Auto-advance slides'),
  autoAdvanceInterval: z.number().optional().default(30).describe('Seconds between auto-advance'),
  showControls: z.boolean().optional().default(true).describe('Show navigation controls'),
  showProgress: z.boolean().optional().default(true).describe('Show progress indicator'),
  showNotes: z.boolean().optional().default(false).describe('Show speaker notes'),
  enableLaserPointer: z.boolean().optional().default(true).describe('Enable laser pointer mode'),
  totalDuration: z.number().optional().describe('Total presentation duration in minutes'),
  author: z.string().optional().describe('Presentation author'),
  createdAt: z.string().optional().describe('Creation date'),
  tags: z.array(z.string()).optional().describe('Presentation tags'),
});

export type Slide = z.infer<typeof slideSchema>;
export type PresentationDeck = z.infer<typeof presentationDeckSchema>;
export type PresentationDeckProps = z.infer<typeof presentationDeckSchema>;
