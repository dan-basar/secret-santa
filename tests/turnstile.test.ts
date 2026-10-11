import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '@/lib/turnstile';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(console.error).mockRestore();
});

describe('verifyTurnstile', () => {
  it('is true only when Cloudflare says success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    expect(await verifyTurnstile('token')).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    expect(await verifyTurnstile('token')).toBe(false);
  });

  it('sends the token with a timeout', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal('fetch', fetch);
    await verifyTurnstile('the-token');
    const init = fetch.mock.calls[0][1];
    expect(JSON.parse(init.body as string).response).toBe('the-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is false, not an exception, when Cloudflare cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await verifyTurnstile('token')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('is false, not an exception, when the reply is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })));
    expect(await verifyTurnstile('token')).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
