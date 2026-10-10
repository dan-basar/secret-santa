import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { sql } from '@/lib/db';
import { isMatchingPossible, createMatches, normalizeGroup, Participant } from '@/lib/matching';
import { hasHtmlTag } from '@/lib/sanitize';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  // The body is untrusted JSON: check its shape before touching any field, so a
  // malformed request gets a 400 instead of crashing on .length or .trim()
  const input: unknown = req.body?.participants;
  if (!Array.isArray(input)) {
    return res.status(400).json({ error: 'Participants must be a list.' });
  }
  if (!input.every(isParticipantInput)) {
    return res.status(400).json({ error: 'Each participant needs a text name; email and group must be text if given.' });
  }

  if (input.length < 2) {
    return res.status(400).json({ error: 'At least 2 participants required.' });
  }
  if (input.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 participants allowed.' });
  }

  // Names and groups are stored as plain text exactly as typed (e.g. "Tom & Jerry");
  // React escapes them on screen and email.ts escapes them in emails
  const participants: Participant[] = input.map(p => ({
    name: p.name.trim(),
    email: (p.email ?? '').trim().toLowerCase(),
    group: (p.group ?? '').trim(),
  }));

  // Group names that differ only in case are one group, as in matching
  const groupNames = new Set(participants.map(p => normalizeGroup(p.group)).filter(Boolean));
  if (groupNames.size > 20) {
    return res.status(400).json({ error: 'Maximum 20 groups allowed.' });
  }
  if (participants.some(p => p.group.length > 200)) {
    return res.status(400).json({ error: 'Group names must be 200 characters or fewer.' });
  }

  const emptyNames = participants.filter(p => !p.name);
  if (emptyNames.length > 0) {
    return res.status(400).json({ error: 'All participants must have a name.' });
  }

  // Column sizes in sql/setup.sql; longer values would fail in the database
  if (participants.some(p => p.name.length > 200)) {
    return res.status(400).json({ error: 'Names must be 200 characters or fewer.' });
  }
  if (participants.some(p => p.email.length > 320)) {
    return res.status(400).json({ error: 'Email addresses must be 320 characters or fewer.' });
  }

  if (participants.some(p => hasHtmlTag(p.name) || hasHtmlTag(p.group))) {
    return res.status(400).json({ error: 'Names and groups cannot contain HTML.' });
  }

  // Validate email format if provided
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = participants.filter(p => p.email && !emailRegex.test(p.email));
  if (invalidEmails.length > 0) {
    return res.status(400).json({
      error: `Invalid email address for: ${invalidEmails.map(p => p.name).join(', ')}`,
    });
  }

  const check = isMatchingPossible(participants);
  if (!check.possible) {
    return res.status(422).json({ error: check.reason });
  }

  const matches = createMatches(participants);
  if (!matches) {
    return res.status(422).json({ error: 'Could not find a valid matching. Please adjust your groups.' });
  }

  const drawId = randomUUID();
  const adminKey = randomUUID();

  // Positions are 1-based to match WITH ORDINALITY below. Matches reference
  // participants by position rather than name, so two people with the same
  // name in one draw still map to their own rows. createMatches() returns the
  // same object references it was given, so indexOf identifies each person.
  const giverPositions = matches.map(match => participants.indexOf(match.giver) + 1);
  const receiverPositions = matches.map(match => participants.indexOf(match.receiver) + 1);

  try {
    // One HTTPS round trip; Neon runs the statements in a single transaction
    // and rolls back all of them if any fails
    await sql.transaction([
      sql`
        INSERT INTO Draws (id, admin_key)
        VALUES (${drawId}::uuid, ${adminKey})
      `,
      sql`
        INSERT INTO Participants (draw_id, position, name, email, group_name)
        SELECT
             ${drawId}::uuid
            ,input.position
            ,input.name
            ,input.email
            ,input.group_name
        FROM unnest(${participants.map(p => p.name)}::varchar[], ${participants.map(p => p.email || null)}::varchar[], ${participants.map(p => p.group || null)}::varchar[]) WITH ORDINALITY as input(name, email, group_name, position)
      `,
      sql`
        INSERT INTO Matches (draw_id, giver_participant_id, receiver_participant_id)
        SELECT
             ${drawId}::uuid
            ,givers.id
            ,receivers.id
        FROM unnest(${giverPositions}::int[], ${receiverPositions}::int[]) as pairs(giver_position, receiver_position)
             INNER JOIN Participants as givers ON givers.draw_id = ${drawId}::uuid
                       AND givers.position = pairs.giver_position
             INNER JOIN Participants as receivers ON receivers.draw_id = ${drawId}::uuid
                       AND receivers.position = pairs.receiver_position
      `,
    ]);
    return res.status(200).json({ drawId, adminKey });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}

interface ParticipantInput {
  name: string;
  email?: string | null;
  group?: string | null;
}

function isParticipantInput(value: unknown): value is ParticipantInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { name, email, group } = value as Record<string, unknown>;
  return typeof name === 'string'
    && (email == null || typeof email === 'string')
    && (group == null || typeof group === 'string');
}
