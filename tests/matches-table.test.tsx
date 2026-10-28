// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MatchesTable from '@/components/draw/MatchesTable';
import type { AdminParticipant } from '@/types/api';

afterEach(cleanup);

const participants: AdminParticipant[] = ['Alex', 'Sam'].map((name, i) => ({
  name, email: null, group_name: null, reveal_code: `token-${i}`, email_sent_at: null, revealed_at: null,
}));

// The page keeps whether the table is shown
function Table() {
  const [shown, setShown] = useState(false);
  return (
    <MatchesTable
      participants={participants}
      matches={[{ giver: 0, receiver: 1 }, { giver: 1, receiver: 0 }]}
      emailsSent={false}
      onEditAndRedraw={() => {}}
      shown={shown}
      onShow={() => setShown(true)}
    />
  );
}

describe('MatchesTable', () => {
  it('keeps the pairings hidden until the organizer asks to see them', () => {
    render(<Table />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Sam')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all matches' }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByText('Sam')).toHaveLength(2);
  });

  it('moves focus to the table it shows, so a screen reader reads it out', () => {
    render(<Table />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all matches' }));
    expect(document.activeElement).toBe(screen.getByRole('table', { name: 'Matches' }));
  });
});
