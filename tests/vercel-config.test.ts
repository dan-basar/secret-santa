import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  functions: Record<string, { maxDuration: number; regions: string[] }>;
  crons: { path: string; schedule: string }[];
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

  it('gives send-emails 120 seconds, ops-check 30 and every other route 10, all in cle1', () => {
    const longer: Record<string, number> = { 'send-emails.ts': 120, 'ops-check.ts': 30 };
    for (const route of routes) {
      const entry = config.functions[route];
      expect(entry.maxDuration, route).toBe(longer[route.split('/').pop()!] ?? 10);
      expect(entry.regions, route).toEqual(['cle1']);
    }
  });

  it('runs the daily check at 00:00 UTC and the weekly report on Sundays at 17:00 UTC', () => {
    expect(config.crons).toEqual([
      { path: '/secret-santa/api/ops-check', schedule: '0 0 * * *' },
      { path: '/secret-santa/api/ops-check?report=weekly', schedule: '0 17 * * 0' },
    ]);
    expect(routes).toContain('src/pages/api/ops-check.ts');
  });
});
