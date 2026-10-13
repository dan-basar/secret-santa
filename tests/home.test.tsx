// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const router = { basePath: '/secret-santa', push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

import Home from '@/pages/index';

const fetchMock = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  router.push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ adminKey: 'key-1' }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

// The participants create-draw was sent
function sentParticipants() {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string).participants as { name: string; email: string; group: string }[];
}

describe('home form', () => {
  it('labels every input and names every remove button', () => {
    render(<Home />);
    for (const label of ['Group 1 name', 'Person 1 name', 'Person 1 group', 'Person 1 email', 'Person 2 name']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Remove group 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove person 2' })).toBeTruthy();
  });

  it('keeps a group\'s members when the group is renamed, even through a blank name', async () => {
    render(<Home />);
    type('Group 1 name', 'Smiths');
    type('Person 1 name', 'Ann');
    type('Person 2 name', 'Bob');
    fireEvent.click(screen.getByRole('button', { name: /add participant/i }));
    type('Person 3 name', 'Cat');
    const annGroup = screen.getByLabelText('Person 1 group') as HTMLSelectElement;
    const smithsId = Array.from(annGroup.options).find((o) => o.text === 'Smiths')!.value;
    fireEvent.change(annGroup, { target: { value: smithsId } });

    // Clearing the name hides the group from the dropdown until it is named again
    type('Group 1 name', '');
    expect(annGroup.value).toBe('');
    type('Group 1 name', 'Joneses');
    expect(annGroup.value).toBe(smithsId);
    expect(annGroup.selectedOptions[0].text).toBe('Joneses');

    fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/draw#key-1'));
    expect(fetchMock.mock.calls[0][0]).toBe('/secret-santa/api/create-draw');
    expect(sentParticipants()).toEqual([
      { name: 'Ann', email: '', group: 'Joneses' },
      { name: 'Bob', email: '', group: '' },
      { name: 'Cat', email: '', group: '' },
    ]);
  });

  it('drops a removed group from its members', async () => {
    render(<Home />);
    type('Group 1 name', 'Smiths');
    fireEvent.click(screen.getByRole('button', { name: /add group/i }));
    type('Group 2 name', 'Joneses');
    type('Person 1 name', 'Ann');
    type('Person 2 name', 'Bob');
    const annGroup = screen.getByLabelText('Person 1 group') as HTMLSelectElement;
    fireEvent.change(annGroup, { target: { value: Array.from(annGroup.options).find((o) => o.text === 'Smiths')!.value } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove group 1' }));
    expect(annGroup.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentParticipants()[0].group).toBe('');
  });

  it('shows an inline error and sends nothing for an invalid email', () => {
    render(<Home />);
    type('Person 1 name', 'Ann');
    type('Person 2 name', 'Bob');
    for (const email of ['ann@example', '<ann@example.com>']) {
      type('Person 1 email', email);
      fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
      expect(screen.getByText('Please fix: Person 1 (Ann) has an email address that isn\'t valid.')).toBeTruthy();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names each row that needs fixing', () => {
    render(<Home />);
    type('Person 1 email', 'ann@example');
    type('Person 2 email', 'bob@example.com');
    fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
    expect(screen.getByText('Please fix: Person 1 needs a name; Person 2 needs a name.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for at least two participants', () => {
    render(<Home />);
    type('Person 1 name', 'Ann');
    fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
    expect(screen.getByText('Please enter at least 2 participants.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks names that only differ in case or spaces, and says why', () => {
    render(<Home />);
    type('Person 1 name', 'Sam');
    type('Person 2 name', ' sam');
    fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/Names must be distinguishable.*: Sam\./);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('saving the form as it is typed', () => {
    const draft = () => sessionStorage.getItem('homeFormDraft');

    it('keeps what was typed through a reload', () => {
      const first = render(<Home />);
      type('Group 1 name', 'Smiths');
      type('Person 1 name', 'Ann');
      type('Person 1 email', 'ann@example.com');
      fireEvent.click(screen.getByRole('button', { name: /add participant/i }));
      type('Person 3 name', 'Cat');
      first.unmount();

      render(<Home />);
      expect((screen.getByLabelText('Group 1 name') as HTMLInputElement).value).toBe('Smiths');
      expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('Ann');
      expect((screen.getByLabelText('Person 1 email') as HTMLInputElement).value).toBe('ann@example.com');
      expect((screen.getByLabelText('Person 3 name') as HTMLInputElement).value).toBe('Cat');
    });

    it('saves nothing for a form with nothing typed in it, and does not wipe a draft while restoring', () => {
      const first = render(<Home />);
      expect(draft()).toBeNull();
      type('Person 1 name', 'Ann');
      first.unmount();
      render(<Home />);
      expect(JSON.parse(draft()!).participants[0].name).toBe('Ann');
    });

    it('ignores a saved draft that is not a form this page built', () => {
      for (const bad of ['not json', '{}', JSON.stringify({ groups: [], participants: [] }),
        JSON.stringify({ groups: [{ id: 'g', name: 'x' }], participants: [{ id: 'p', name: 1, email: '', groupId: '' }, { id: 'q', name: '', email: '', groupId: '' }] })]) {
        sessionStorage.setItem('homeFormDraft', bad);
        render(<Home />);
        expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('');
        expect(screen.getAllByLabelText(/Person \d+ name/)).toHaveLength(2);
        cleanup();
      }
    });

    it('clears the form after a confirmation, and Keep leaves it alone', () => {
      render(<Home />);
      type('Group 1 name', 'Smiths');
      type('Person 1 name', 'Ann');

      fireEvent.click(screen.getByRole('button', { name: 'Clear form' }));
      expect(screen.getByRole('alert').textContent).toMatch(/Clear all names, emails and groups\?/);
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('Ann');
      expect(screen.queryByRole('alert')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Clear form' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }));
      expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Group 1 name') as HTMLInputElement).value).toBe('');
      expect(screen.getAllByLabelText(/Person \d+ name/)).toHaveLength(2);
      expect(draft()).toBeNull();
    });

    it('forgets the draft once the draw is created', async () => {
      render(<Home />);
      type('Person 1 name', 'Ann');
      type('Person 2 name', 'Bob');
      expect(draft()).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
      await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/draw#key-1'));
      expect(draft()).toBeNull();
    });

    it('keeps the draft when the draw fails, so a retry does not mean retyping', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Failed' }) });
      render(<Home />);
      type('Person 1 name', 'Ann');
      type('Person 2 name', 'Bob');
      fireEvent.click(screen.getByRole('button', { name: /draw matches/i }));
      await screen.findByText('Failed');
      expect(draft()).not.toBeNull();
    });

    it("prefers Edit & Redraw's hand-off, and keeps what it replaces through a reload", () => {
      sessionStorage.setItem('homeFormDraft', JSON.stringify({
        groups: [{ id: 'g1', name: '' }],
        participants: [{ id: 'a', name: 'Old', email: '', groupId: '' }, { id: 'b', name: 'Draft', email: '', groupId: '' }],
      }));
      sessionStorage.setItem('editDraftData', JSON.stringify({
        groups: [{ id: 'g1', name: '' }],
        participants: [{ id: 'c', name: 'Cy', email: '', groupId: '' }, { id: 'd', name: 'Di', email: '', groupId: '' }],
        replacesDrawId: 'draw-1',
        replacesKey: 'key-1',
      }));
      const first = render(<Home />);
      expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('Cy');
      expect(sessionStorage.getItem('editDraftData')).toBeNull();
      first.unmount();

      render(<Home />);
      expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('Cy');
      expect(screen.getByText(/This will replace your earlier draw/)).toBeTruthy();
    });

    it('still works when storage is blocked', () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      render(<Home />);
      type('Person 1 name', 'Ann');
      expect((screen.getByLabelText('Person 1 name') as HTMLInputElement).value).toBe('Ann');
      getItem.mockRestore();
      setItem.mockRestore();
    });
  });
});
