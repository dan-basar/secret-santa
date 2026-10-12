// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import OrganizerLink from '@/components/draw/OrganizerLink';
import PersonalLinks from '@/components/draw/PersonalLinks';

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true });
}

const participants = [
  { name: 'Alex', email: null, group_name: null, reveal_token: 'token-a', email_sent_at: null },
  { name: 'Sam', email: null, group_name: null, reveal_token: 'token-s', email_sent_at: null },
];

afterEach(() => {
  cleanup();
});

describe('copy buttons', () => {
  it('says Copied once the organizer link is on the clipboard', async () => {
    stubClipboard(async () => {});
    render(<OrganizerLink url="https://example.com/secret-santa/draw#Ab3dEf6hIj9kLm" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: '✓ Copied' })).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/secret-santa/draw#Ab3dEf6hIj9kLm');
  });

  it('says Copy failed when the clipboard refuses the organizer link', async () => {
    stubClipboard(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
    render(<OrganizerLink url="https://example.com/secret-santa/draw#Ab3dEf6hIj9kLm" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy();
    expect(screen.queryByText('✓ Copied')).toBeNull();
  });

  it('marks only the copied personal link, and says when the copy failed', async () => {
    stubClipboard(async () => {});
    render(<PersonalLinks participants={participants} emailsSent={false} linkFor={token => `https://example.com/reveal/${token}`} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[1]);
    expect(await screen.findByRole('button', { name: '✓ Copied' })).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/reveal/token-s');
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1);

    stubClipboard(async () => { throw new Error('Denied'); });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy();
    expect(screen.queryByText('✓ Copied')).toBeNull();
  });
});
