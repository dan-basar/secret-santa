// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const router = { isReady: true, query: {}, basePath: '/secret-santa', replace: vi.fn(), push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

import DrawPage from '@/pages/draw';

const ADMIN_KEY = 'Ab3dEf6hIj9kLm';

const adminView = {
  id: 'f59fac1f-4e1f-45c8-96f6-9c6c738c3876', created_at: '2026-10-01T00:00:00.000Z', emails_sent_at: null,
  participants: [
    { name: 'Alex', email: null, group_name: null, reveal_token: 'Aa111111', email_sent_at: null },
    { name: 'Sam', email: null, group_name: null, reveal_token: 'Bb222222', email_sent_at: null },
  ],
  matches: [{ giver: 0, receiver: 1 }, { giver: 1, receiver: 0 }],
};

function answer(status: number, body: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
}

beforeEach(() => {
  answer(200, adminView);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('draw page', () => {
  it('sends the key from the fragment in a header, never in the URL', async () => {
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    await screen.findByText('Your organizer link', { exact: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/secret-santa/api/get-draw');
    expect(init.headers).toEqual({ 'X-Admin-Key': ADMIN_KEY });
  });

  it('shows the organizer their own link to copy', async () => {
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    expect(await screen.findByText('Your organizer link', { exact: true })).toBeTruthy();
    expect(screen.getByText(/Keep it private: it shows everyone.s matches!/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`/secret-santa/draw#${ADMIN_KEY}$`))).toBeTruthy();
  });

  it('says a key cut short looks incomplete, without asking the server', async () => {
    window.location.hash = `#${ADMIN_KEY.slice(0, 9)}`;
    render(<DrawPage />);
    expect(await screen.findByText('This link looks incomplete')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says a link with no key or an unknown key matches no draw', async () => {
    render(<DrawPage />);
    expect(await screen.findByText('This link looks incomplete')).toBeTruthy();
    cleanup();

    answer(404, { error: 'Draw not found.' });
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    expect(await screen.findByText('Draw not found')).toBeTruthy();
  });

  it('says so when this network has made too many lookups', async () => {
    answer(429, { error: 'Too many requests' });
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    expect(await screen.findByText(/Too many tries from this network/)).toBeTruthy();
  });

  it('loads the other draw when another organizer link is pasted into the same tab', async () => {
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    await screen.findByText('Your organizer link', { exact: true });
    const otherKey = 'Zz9yXx8wVv7uTt';
    await act(async () => {
      window.location.hash = `#${otherKey}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.at(-1)![1]).toEqual({ headers: { 'X-Admin-Key': otherKey } }));
  });
});
