import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// No database in tests: each sql`...` call resolves to the rows queued below
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, sql: vi.fn(async () => []) };
});

import { proxy } from '@/proxy';
import { sql } from '@/lib/db';

function request(path: string, ip = '203.0.113.7') {
  return new NextRequest(`http://localhost/secret-santa${path}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  });
}

beforeEach(() => {
  vi.mocked(sql).mockReset();
  vi.mocked(sql).mockResolvedValue([]);
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // no cleanup unless a test asks
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('proxy rate limiting', () => {
  it('lets a request under the limit through', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ hits: 10 }]);
    const res = await proxy(request('/api/create-draw'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('returns 429 with an error once the route limit is passed', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ hits: 6 }]);
    const res = await proxy(request('/api/send-emails'));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: 'Sorry, too many requests from your IP address. Please try again later.',
    });
  });

  it('stores a SHA-256 hash of the IP and route, never the raw IP', async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ hits: 1 }]);
    await proxy(request('/api/delete-draw'));
    const params = vi.mocked(sql).mock.calls[0].slice(1);
    expect(params).toHaveLength(1);
    expect(params[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(params[0]).not.toContain('203.0.113.7');
  });

  it('counts each route separately for the same IP', async () => {
    vi.mocked(sql).mockResolvedValue([{ hits: 1 }]);
    await proxy(request('/api/create-draw'));
    await proxy(request('/api/delete-draw'));
    const [first, second] = vi.mocked(sql).mock.calls.map(call => call[1]);
    expect(first).not.toBe(second);
  });

  it('fails open when the database errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sql).mockRejectedValueOnce(new Error('Neon unreachable'));
    const res = await proxy(request('/api/create-draw'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(console.error).toHaveBeenCalled();
  });

  it('deletes old counter rows on roughly 1 in 100 requests', async () => {
    vi.mocked(Math.random).mockReturnValue(0.001);
    vi.mocked(sql).mockResolvedValueOnce([{ hits: 1 }]);
    await proxy(request('/api/create-draw'));
    expect(vi.mocked(sql)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sql).mock.calls[1][0].join('')).toContain('DELETE FROM RateLimits');
  });

  it('does not touch the database for unlimited routes', async () => {
    const res = await proxy(request('/api/get-draw'));
    expect(res.status).toBe(200);
    expect(vi.mocked(sql)).not.toHaveBeenCalled();
  });
});
