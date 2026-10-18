import type { AdminMatch, AdminParticipant } from '@/types/api';

// The organizer's list of matches (F6), shared by the matches table, the print
// sheet, the CSV download and the PDF

export interface MatchPair {
  giver: AdminParticipant;
  receiver: AdminParticipant;
}

/** Grouped people first, by group, then by giver name: the order the matches table shows */
export function sortedPairs(participants: AdminParticipant[], matches: AdminMatch[]): MatchPair[] {
  return matches
    .map((m) => ({ giver: participants[m.giver], receiver: participants[m.receiver] }))
    .sort((a, b) => {
      const aGroup = a.giver.group_name || '';
      const bGroup = b.giver.group_name || '';
      if (aGroup && !bGroup) return -1;
      if (!aGroup && bGroup) return 1;
      const groupCmp = aGroup.localeCompare(bGroup);
      if (groupCmp !== 0) return groupCmp;
      return a.giver.name.localeCompare(b.giver.name);
    });
}

/** Group columns appear only when someone is in a group, email columns only when someone has an email */
export function listColumns(participants: AdminParticipant[]): { groups: boolean; emails: boolean } {
  return {
    groups: participants.some((p) => p.group_name),
    emails: participants.some((p) => p.email),
  };
}

// Quotes a value that holds a comma, quote or line break. A value starting with
// = + - @ or a tab gets a leading apostrophe, so a spreadsheet shows it as text
// instead of running it as a formula (names are typed by whoever made the draw)
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One row per Secret Santa: Secret Santa, Group, Email, Match Name, Match Group,
 * Match Email. The group columns are left out when nobody has a group and the
 * email columns when nobody has an email. Someone with no group gets a blank cell, so a group
 * really called "No group" can't be mistaken for none; someone with no email reads "No email"
 */
export function matchesCsv(participants: AdminParticipant[], matches: AdminMatch[]): string {
  const cols = listColumns(participants);
  const header = [
    'Secret Santa', ...(cols.groups ? ['Group'] : []), ...(cols.emails ? ['Email'] : []),
    'Match Name', ...(cols.groups ? ['Match Group'] : []), ...(cols.emails ? ['Match Email'] : []),
  ];
  const person = (p: AdminParticipant) => [
    p.name,
    ...(cols.groups ? [p.group_name ?? ''] : []),
    ...(cols.emails ? [p.email || 'No email'] : []),
  ];
  const rows = sortedPairs(participants, matches).map((m) => [...person(m.giver), ...person(m.receiver)]);
  // CRLF is what spreadsheet apps expect
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** The line under the printed title: "Organized by Dan · Draw created October 15, 2026 · 6 participants" */
export function listSubtitle(organizerName: string, createdAt: string, count: number): string {
  const created = new Date(createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return [
    ...(organizerName ? [`Organized by ${organizerName}`] : []),
    `Draw created ${created}`,
    `${count} participant${count !== 1 ? 's' : ''}`,
  ].join(' · ');
}

/** "secret-santa-matches-2026-10-15", from the day the draw was made */
export function exportFileName(createdAt: string): string {
  return `secret-santa-matches-${createdAt.slice(0, 10)}`;
}
