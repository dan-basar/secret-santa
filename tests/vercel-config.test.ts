import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  functions: Record<string, { maxDuration: number; regions: string[] }>;
};
const routes = readdirSync(join(root, 'src/pages/api'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `src/pages/api/${file}`);

// Enough of Vercel's glob syntax to catch a key that matches more files than intended.
function matches(pattern: string, path: string): boolean {
  const regex = pattern
    .split(/(\*\*|\*)/)
    .map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${regex}$`).test(path);
}

describe('vercel.json functions', () => {
  it('gives every API route exactly one entry', () => {
    for (const route of routes) {
      const keys = Object.keys(config.functions).filter((key) => matches(key, route));
      expect(keys, route).toEqual([route]);
    }
  });

  it('has no entries for files that do not exist', () => {
    expect(Object.keys(config.functions).sort()).toEqual([...routes].sort());
  });

  it('gives send-emails 60 seconds and every other route 10, all in cle1', () => {
    for (const route of routes) {
      const entry = config.functions[route];
      expect(entry.maxDuration, route).toBe(route.endsWith('/send-emails.ts') ? 60 : 10);
      expect(entry.regions, route).toEqual(['cle1']);
    }
  });
});
