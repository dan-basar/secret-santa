// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const DRAW_ID = 'f59fac1f-4e1f-45c8-96f6-9c6c738c3876';
const router = { isReady: true, query: { id: DRAW_ID }, basePath: '/secret-santa', replace: vi.fn(), push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

import DrawPage from '@/pages/draw/[id]';

// What get-draw answers without a valid admin key: names only
const sharedView = { id: DRAW_ID, created_at: '2026-10-01T00:00:00.000Z', isAdmin: false, participants: [{ name: 'Alex' }, { name: 'Sam' }] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => sharedView })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('draw page', () => {
  it('says so when an organizer link\'s key does not match the draw', async () => {
    window.location.hash = '#key=cut-off';
    render(<DrawPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/key doesn.t match this draw/);
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('shows the shared link plainly, with no warning and no link to copy', async () => {
    render(<DrawPage />);
    await screen.findByText('Alex');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Your organizer link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('shows the organizer their own link, with its key, to copy', async () => {
    const adminView = {
      id: DRAW_ID, created_at: '2026-10-01T00:00:00.000Z', emails_sent_at: null, isAdmin: true,
      participants: [
        { name: 'Alex', email: null, group_name: null, reveal_token: 'token-a', email_sent_at: null },
        { name: 'Sam', email: null, group_name: null, reveal_token: 'token-s', email_sent_at: null },
      ],
      matches: [{ giver: 0, receiver: 1 }, { giver: 1, receiver: 0 }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => adminView })));
    window.location.hash = '#key=the-key';
    render(<DrawPage />);
    expect(await screen.findByText('Your organizer link')).toBeTruthy();
    expect(screen.getByText(/Keep it private: it shows everyone.s matches!/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`/secret-santa/draw/${DRAW_ID}#key=the-key$`))).toBeTruthy();
  });
});
