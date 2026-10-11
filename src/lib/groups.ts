import { normalizeGroup } from '@/lib/matching';

// Form state for the home page. Participants point at a group by its id, not
// its name, so renaming a group (or clearing its name to retype it) keeps
// everyone assigned to it.

export interface FormGroup {
  id: string;
  name: string;
}

export interface FormParticipant {
  id: string;
  name: string;
  email: string;
  groupId: string; // '' for no group
}

export function newId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * The group name sent to create-draw: the trimmed name of the referenced
 * group, or '' when there is no group or its name is blank.
 */
export function groupNameFor(groups: FormGroup[], groupId: string): string {
  return groups.find((g) => g.id === groupId)?.name.trim() ?? '';
}

/**
 * Rebuilds the form from a saved draw for Edit & Redraw: one group per distinct
 * name (case-insensitive, as matching compares them, keeping the first
 * spelling) and each participant pointed at their group's id.
 */
export function formFromParticipants(
  people: Array<{ name: string; email: string; group: string }>
): { groups: FormGroup[]; participants: FormParticipant[] } {
  const groupIds = new Map<string, string>();
  const groups: FormGroup[] = [];

  const participants = people.map((p) => {
    const key = normalizeGroup(p.group);
    if (key && !groupIds.has(key)) {
      const group = { id: newId(), name: p.group.trim() };
      groupIds.set(key, group.id);
      groups.push(group);
    }
    return { id: newId(), name: p.name, email: p.email, groupId: groupIds.get(key) ?? '' };
  });

  return { groups: groups.length > 0 ? groups : [{ id: newId(), name: '' }], participants };
}
