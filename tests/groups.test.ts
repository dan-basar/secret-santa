import { describe, expect, it } from 'vitest';
import { formFromParticipants, groupNameFor } from '@/lib/groups';

describe('groupNameFor', () => {
  const groups = [
    { id: 'a', name: '  Smiths ' },
    { id: 'b', name: '   ' },
  ];

  it('returns the trimmed name of the referenced group', () => {
    expect(groupNameFor(groups, 'a')).toBe('Smiths');
  });

  it('follows a rename, since participants hold the id', () => {
    const renamed = [{ id: 'a', name: 'Joneses' }, groups[1]];
    expect(groupNameFor(renamed, 'a')).toBe('Joneses');
  });

  it('returns empty for no group, a removed group or a blank name', () => {
    expect(groupNameFor(groups, '')).toBe('');
    expect(groupNameFor(groups, 'gone')).toBe('');
    expect(groupNameFor(groups, 'b')).toBe('');
  });
});

describe('formFromParticipants', () => {
  it('makes one group per distinct name and points each participant at it', () => {
    const { groups, participants } = formFromParticipants([
      { name: 'Ann', email: 'ann@example.com', group: 'Smiths' },
      { name: 'Bob', email: '', group: 'Joneses' },
      { name: 'Cat', email: '', group: 'Smiths' },
      { name: 'Dan', email: '', group: '' },
    ]);

    expect(groups.map((g) => g.name)).toEqual(['Smiths', 'Joneses']);
    expect(participants.map((p) => groupNameFor(groups, p.groupId))).toEqual(['Smiths', 'Joneses', 'Smiths', '']);
    expect(participants[0]).toMatchObject({ name: 'Ann', email: 'ann@example.com' });
    expect(new Set(participants.map((p) => p.id)).size).toBe(4);
  });

  it('merges names that differ only in case, as matching does', () => {
    const { groups, participants } = formFromParticipants([
      { name: 'Ann', email: '', group: 'Family' },
      { name: 'Bob', email: '', group: ' family ' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Family');
    expect(participants[0].groupId).toBe(participants[1].groupId);
  });

  it('leaves one empty group row when nobody had a group', () => {
    const { groups, participants } = formFromParticipants([
      { name: 'Ann', email: '', group: '' },
      { name: 'Bob', email: '', group: '' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('');
    expect(participants.every((p) => p.groupId === '')).toBe(true);
  });
});
