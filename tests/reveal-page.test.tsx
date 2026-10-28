// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/router', () => ({ useRouter: () => ({ basePath: '/secret-santa', query: { token: 'abcd2345' } }) }));

import RevealPage from '@/pages/reveal/[token]';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      name: 'Ann', match_name: 'Bob', created_at: '2026-10-01T00:00:00.000Z',
      organizer_name: null, organizer_note: null, budget_cents: null, exchange_date: null,
    }),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reveal page', () => {
  it('moves focus to the match once revealed, so a screen reader reads it out', async () => {
    render(<RevealPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tap to reveal' }));
    expect(document.activeElement).toBe(screen.getByText('Bob'));
  });
});
