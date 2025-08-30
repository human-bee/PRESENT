import { z } from 'zod';

export const componentToolboxSchema = z.object({});

export const aiResponseSchema = z.object({
  content: z.string().describe('The AI response content in markdown format'),
  role: z
    .enum(['assistant', 'user'])
    .default('assistant')
    .describe('The role of the message sender'),
  isLoading: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether the message is in a loading state'),
});

