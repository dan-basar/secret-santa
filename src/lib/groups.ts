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

// A draw's limits, enforced by the home form and create-draw; a saved draft
// outside them is not restored
export const MAX_PARTICIPANTS = 50;
export const MAX_GROUPS = 20;

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

export interface FormDraft {
  groups: FormGroup[];
  participants: FormParticipant[];
  replacesKey?: string; // Edit & Redraw: the admin key of the draw being replaced
}

const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * Parses a saved form (Edit & Redraw's hand-off or the as-you-type draft),
 * returning null for anything that isn't a form this page could have built.
 */
export function parseFormDraft(raw: string): FormDraft | null {
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d?.groups) || d.groups.length < 1 || d.groups.length > MAX_GROUPS) return null;
    if (!Array.isArray(d.participants) || d.participants.length < 2 || d.participants.length > MAX_PARTICIPANTS) return null;
    if (!d.groups.every((g: Record<string, unknown>) => isString(g?.id) && isString(g.name))) return null;
    if (!d.participants.every((p: Record<string, unknown>) =>
      isString(p?.id) && isString(p.name) && isString(p.email) && isString(p.groupId))) return null;
    const draft: FormDraft = {
      groups: d.groups.map((g: FormGroup) => ({ id: g.id, name: g.name })),
      participants: d.participants.map((p: FormParticipant) => ({ id: p.id, name: p.name, email: p.email, groupId: p.groupId })),
    };
    if (isString(d.replacesKey)) draft.replacesKey = d.replacesKey;
    return draft;
  } catch {
    return null;
  }
}
