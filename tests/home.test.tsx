// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const router = { basePath: '/secret-santa', push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

import Home from '@/pages/index';

const fetchMock = vi.fn();

beforeEach(() => {
  router.push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ drawId: 'draw-1', adminKey: 'key-1' }) });
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
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/draw/draw-1#key=key-1'));
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
});
