import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

const TARGET_FILES = [
  'src/app/page.tsx',
  'src/app/not-found.tsx',
  'src/app/canvas/CanvasPageClient.tsx',
  'src/components/ui/canvas/canvas-space.tsx',
  'src/components/ui/messaging/message-thread-collapsible.tsx',
  'src/components/ui/tldraw/tldraw-with-persistence.tsx',
  'src/app/auth/signin/page.tsx',
  'src/app/auth/signup/page.tsx',
  'src/app/auth/finish/page.tsx',
  'src/app/canvases/page.tsx',
  'src/app/mcp-config/page.tsx',
];

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Tailwind gradients', re: /\bbg-gradient-to-\w+\b/ },
  {
    name: 'Hard-coded palette utilities (gray/blue/etc)',
    re: /\b(?:bg|text|border|ring)-(?:gray|slate|zinc|neutral|stone|blue|indigo|purple|emerald|green|red|yellow|orange)-[0-9]{2,3}\b/,
  },
];

describe('UI style contract (OpenAI parity)', () => {
  test('migrated pages/components avoid ad-hoc palette classes', () => {
    const violations: Array<{ file: string; pattern: string; snippet: string }> = [];

    for (const rel of TARGET_FILES) {
      const abs = path.join(REPO_ROOT, rel);
      const contents = fs.readFileSync(abs, 'utf8');
      for (const { name, re } of FORBIDDEN_PATTERNS) {
        const match = contents.match(re);
        if (match) {
          violations.push({
            file: rel,
            pattern: name,
            snippet: match[0],
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `${v.file}: ${v.pattern}: ${v.snippet}`)
        .join('\n');
      throw new Error(`Found forbidden style patterns:\n${msg}`);
    }
  });
});

