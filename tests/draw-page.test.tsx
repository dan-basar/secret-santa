// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';

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

  it('keeps the save and print card faded and disabled until the matches are shown', async () => {
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    const card = (await screen.findByRole('heading', { name: 'Save or print your Secret Santa' })).closest('section')!;
    for (const name of ['Download CSV', 'Save PDF', 'Print']) {
      expect((within(card).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(within(card).getByText('Export the full list of secret matches.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all matches' }));
    for (const name of ['Download CSV', 'Save PDF', 'Print']) {
      expect((within(card).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('downloads the matches as a CSV file', async () => {
    let saved: Blob | undefined;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => { saved = blob; return 'blob:matches'; }),
      revokeObjectURL: vi.fn(),
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('secret-santa-matches-2026-10-01.csv');
    });
    window.location.hash = `#${ADMIN_KEY}`;
    render(<DrawPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show all matches' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalledOnce();
    // Starts with the UTF-8 byte order mark, which text() drops, so Excel reads accents right
    expect([...new Uint8Array(await saved!.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(await saved!.text()).toBe('Secret Santa,Match Name\r\nAlex,Sam\r\nSam,Alex\r\n');
    click.mockRestore();
  });

  it('prints a sheet of the matches with the details box once they are shown', async () => {
    answer(200, {
      ...adminView,
      participants: [{ ...adminView.participants[0], name: 'Smith, Alex', email: 'alex@example.com' }, adminView.participants[1]],
      organizer_name: 'Dan', organizer_note: 'Bring cocoa', budget_cents: 2500, exchange_date: '2026-12-19',
    });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    window.location.hash = `#${ADMIN_KEY}`;
    const { container } = render(<DrawPage />);
    await screen.findByText('Your organizer link', { exact: true });
    expect(screen.queryByText('Secret Santa matches')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all matches' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledOnce();
    // The sheet comes right before the page, which the print styles hide
    const sheet = container.firstElementChild!;
    expect(within(sheet as HTMLElement).getByText('Secret Santa matches')).toBeTruthy();
    expect(within(sheet as HTMLElement).getByText(/^Organized by Dan · Draw created .+ · 2 participants$/)).toBeTruthy();
    expect(within(sheet as HTMLElement).getByText('Bring cocoa')).toBeTruthy();
    expect(within(sheet as HTMLElement).getByText('$25')).toBeTruthy();
    expect(within(sheet as HTMLElement).getByText('Saturday, December 19')).toBeTruthy();
    expect(within(sheet as HTMLElement).getAllByRole('row')).toHaveLength(3);
    // Each person's email sits under their name, whether they give or receive
    expect(within(sheet as HTMLElement).getAllByText('Smith, Alex')).toHaveLength(2);
    expect(within(sheet as HTMLElement).getAllByText('alex@example.com')).toHaveLength(2);
    expect(within(sheet as HTMLElement).getByText(/Keep this list private! It shows everyone.s secret match\./)).toBeTruthy();
  });
});
