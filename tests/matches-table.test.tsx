// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MatchesTable from '@/components/draw/MatchesTable';
import type { AdminParticipant } from '@/types/api';

afterEach(cleanup);

const participants: AdminParticipant[] = ['Alex', 'Sam'].map((name, i) => ({
  name, email: null, group_name: null, reveal_token: `token-${i}`, email_sent_at: null,
}));

describe('MatchesTable', () => {
  it('keeps the pairings hidden until the organizer asks to see them', () => {
    render(<MatchesTable participants={participants} matches={[{ giver: 0, receiver: 1 }, { giver: 1, receiver: 0 }]} emailsSent={false} onEditAndRedraw={() => {}} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Sam')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all matches' }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByText('Sam')).toHaveLength(2);
  });
});
