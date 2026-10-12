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

  it('shows the shared link plainly, with no warning', async () => {
    render(<DrawPage />);
    await screen.findByText('Alex');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
