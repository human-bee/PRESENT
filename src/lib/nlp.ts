/**
 * Natural Language Processing utilities for Tambo
 * Handles parameter extraction from user messages
 */

/**
 * Extract component update parameters from natural language
 * This is a simple pattern-based approach - the AI models handle complex cases
 */
export function extractParametersWithAI(userMessage: string): Record<string, unknown> {
  const message = userMessage.toLowerCase();
  
  // Simple pattern matching for common cases
  const patterns = [
    // Numbers with units
    { 
      regex: /(\d+(?:\.\d+)?)\s*(min|minute|minutes|hour|hours|second|seconds)/i, 
      handler: (match: RegExpMatchArray) => {
        const num = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (unit.includes('hour')) return { initialMinutes: num * 60 };
        if (unit.includes('second')) return { initialMinutes: Math.max(1, Math.ceil(num / 60)) };
        return { initialMinutes: num };
      }
    },
    // Word numbers
    { 
      regex: /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s*(min|minute|minutes)/i,
      handler: (match: RegExpMatchArray) => {
        const wordToNumber: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, 
          eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, 
          twenty: 20, thirty: 30
        };
        const num = wordToNumber[match[1].toLowerCase()];
        return num ? { initialMinutes: num } : {};
      }
    },
    // Title/name changes
    { 
      regex: /(?:title|name)\s*(?:to|is)?\s*["\']?([^"']+)["\']?/i,
      handler: (match: RegExpMatchArray) => ({ title: match[1].trim() })
    },
    // Color changes
    {
      regex: /(?:color|colour)\s*(?:to|is)?\s*["\']?([^"']+)["\']?/i,
      handler: (match: RegExpMatchArray) => ({ color: match[1].trim() })
    },
    // Boolean flags
    {
      regex: /(?:set|make|turn)\s*(on|off|true|false|enable|disable)\s*(\w+)?/i,
      handler: (match: RegExpMatchArray) => {
        const value = ['on', 'true', 'enable'].includes(match[1].toLowerCase());
        const property = match[2] || 'enabled';
        return { [property]: value };
      }
    }
  ];
  
  // Try each pattern
  for (const { regex, handler } of patterns) {
    const match = message.match(regex);
    if (match) {
      const result = handler(match);
      if (Object.keys(result).length > 0) return result;
    }
  }
  
  // Return empty object - let the AI figure out complex cases
  return {};
}

/**
 * Extract intent from natural language message
 */
export function extractIntent(message: string): {
  action: 'create' | 'update' | 'delete' | 'list' | 'unknown';
  target?: string;
  confidence: number;
} {
  const lower = message.toLowerCase();
  
  if (lower.includes('create') || lower.includes('make') || lower.includes('add')) {
    return { action: 'create', confidence: 0.8 };
  }
  
  if (lower.includes('update') || lower.includes('change') || lower.includes('set')) {
    return { action: 'update', confidence: 0.8 };
  }
  
  if (lower.includes('delete') || lower.includes('remove')) {
    return { action: 'delete', confidence: 0.8 };
  }
  
  if (lower.includes('list') || lower.includes('show')) {
    return { action: 'list', confidence: 0.8 };
  }
  
  return { action: 'unknown', confidence: 0.0 };
} 