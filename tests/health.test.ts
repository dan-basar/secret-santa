import { describe, it, expect } from 'vitest';
import { callRoute } from './helpers/fake-res';
import handler from '@/pages/api/health';

describe('/api/health', () => {
  it('returns 200 { ok: true } for any method, so HEAD-only uptime monitors work too', async () => {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const res = await callRoute(handler, { method });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it('still answers the address the uptime monitor already uses', async () => {
    const res = await callRoute(handler, { method: 'GET', query: { shallow: '1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
