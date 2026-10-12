// POST /api/create-draw: validates 2-50 participants ({ name, email?, group? }),
// whose names must differ ignoring case and spaces, draws matches and saves the
// draw, participants and matches in one transaction. Anyone may call it. Returns
// 200 { drawId, adminKey }; 400 bad input; 422 no valid matching. Edit & Redraw
// also sends replacesDrawId + replacesKey (that draw's admin key): 403 wrong key,
// 409 emails already sent, 410 already deleted.

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { sql, isUuid } from '@/lib/db';
import { isMatchingPossible, createMatches, normalizeGroup, Participant } from '@/lib/matching';
import { hasHtmlTag, hasLink } from '@/lib/sanitize';
import { isValidEmail } from '@/lib/email-address';
import { duplicateNames, duplicateNamesMessage } from '@/lib/names';
import type { ApiError, CreateDrawResponse } from '@/types/api';

// The draw being replaced by Edit & Redraw
interface OldDrawRow {
  admin_key: string;
  deleted_at: Date | null;
  emails_sent_at: Date | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<CreateDrawResponse | ApiError>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // The body is untrusted JSON: check its shape before touching any field, so a
  // malformed request gets a 400 instead of crashing on .length or .trim()
  const input: unknown = req.body?.participants;
  if (!Array.isArray(input)) {
    return res.status(400).json({ error: 'Participants must be a list.' });
  }
  if (!input.every(isParticipantInput)) {
    return res.status(400).json({ error: 'Each participant needs a text name; email and group must be text if given.' });
  }

  // Edit & Redraw: the old draw is only soft-deleted once its replacement is saved
  const { replacesDrawId, replacesKey } = req.body as { replacesDrawId?: unknown; replacesKey?: unknown };
  if (replacesDrawId != null && (typeof replacesDrawId !== 'string' || !isUuid(replacesDrawId))) {
    return res.status(400).json({ error: 'The draw to replace is not valid.' });
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

  const duplicates = duplicateNames(participants.map(p => p.name));
  if (duplicates.length > 0) {
    return res.status(400).json({ error: duplicateNamesMessage(duplicates) });
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

  // Names are written into the match emails, where a mail app would make a
  // web address clickable. Groups never appear in an email
  const linkNames = participants.filter(p => hasLink(p.name));
  if (linkNames.length > 0) {
    return res.status(400).json({
      error: `Names cannot contain web addresses: ${linkNames.map(p => p.name).join(', ')}`,
    });
  }

  const invalidEmails = participants.filter(p => p.email && !isValidEmail(p.email));
  if (invalidEmails.length > 0) {
    return res.status(400).json({
      error: `Invalid email address for: ${invalidEmails.map(p => p.name).join(', ')}`,
    });
  }

  const check = isMatchingPossible(participants);
  if (!check.possible) {
    return res.status(422).json({ error: check.reason });
  }

  const receivers = createMatches(participants);
  if (!receivers) {
    return res.status(422).json({ error: 'Could not find a valid matching. Please adjust your groups.' });
  }

  if (replacesDrawId) {
    try {
      const oldRows = await sql`
        SELECT
             admin_key
            ,deleted_at
            ,emails_sent_at
        FROM Draws
        WHERE id = ${replacesDrawId}::uuid
      ` as OldDrawRow[];
      if (!oldRows.length || typeof replacesKey !== 'string' || replacesKey !== oldRows[0].admin_key) {
        return res.status(403).json({ error: 'Only the organizer can replace this draw.' });
      }
      if (oldRows[0].deleted_at) {
        return res.status(410).json({ error: 'Your earlier draw has already been deleted.' });
      }
      if (oldRows[0].emails_sent_at) {
        return res.status(409).json({ error: 'Emails for your earlier draw have already gone out, so it can no longer be redrawn.' });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error. Please try again.' });
    }
  }

  const drawId = randomUUID();
  const adminKey = randomUUID();

  // Positions are 1-based to match WITH ORDINALITY below. Matches reference
  // participants by position rather than name, so two people with the same
  // name in one draw still map to their own rows. Participant i gives to
  // participant receivers[i].
  const giverPositions = receivers.map((_, i) => i + 1);
  const receiverPositions = receivers.map(ri => ri + 1);

  try {
    // One HTTPS round trip; Neon runs the statements in a single transaction
    // and rolls back all of them if any fails
    await sql.transaction([
      // If the old draw was deleted or emailed since the check above, no row is
      // updated and 1 / count(*) divides by zero, which rolls everything back
      ...(replacesDrawId ? [sql`
        WITH replaced as (
             UPDATE Draws
             SET deleted_at = now()
             WHERE id = ${replacesDrawId}::uuid
                  AND admin_key = ${replacesKey}
                  AND deleted_at IS NULL
                  AND emails_sent_at IS NULL
             RETURNING id
        )
        SELECT 1 / count(*) FROM replaced
      `] : []),
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
    if ((err as { code?: string }).code === '22012') { // division_by_zero from the replace guard
      return res.status(409).json({ error: 'Your earlier draw changed while you were editing. Open it again and try again.' });
    }
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
