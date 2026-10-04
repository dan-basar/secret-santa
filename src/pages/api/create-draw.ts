import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { isMatchingPossible, createMatches, Participant } from '@/lib/matching';
import { stripHtml } from '@/lib/sanitize';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { participants }: { participants: Participant[] } = req.body;

  if (!participants || participants.length < 2) {
    return res.status(400).json({ error: 'At least 2 participants required.' });
  }
  if (participants.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 participants allowed.' });
  }

  // Sanitize all user-provided text inputs
  for (const p of participants) {
    p.name = stripHtml(p.name);
    p.email = p.email ? p.email.trim().toLowerCase() : '';
    p.group = p.group ? stripHtml(p.group) : '';
  }

  // Re-validate after sanitization (names could become empty after stripping tags)
  const emptyNames = participants.filter(p => !p.name);
  if (emptyNames.length > 0) {
    return res.status(400).json({ error: 'All participants must have a valid name (HTML is not allowed).' });
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

  const drawId = uuidv4();
  const adminKey = uuidv4();

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
