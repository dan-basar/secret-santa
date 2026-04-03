import type { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { getPool, withRetry, sql } from '@/lib/db';
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

  try {
    const result = await withRetry(async () => {
      const pool = await getPool();
      const transaction = new sql.Transaction(pool);

      try {
        await transaction.begin();

        // Insert draw
        const r0 = new sql.Request(transaction);
        await r0
          .input('drawId', sql.UniqueIdentifier, drawId)
          .input('adminKey', sql.NVarChar(100), adminKey)
          .query(`INSERT INTO Draws (id, admin_key) VALUES (@drawId, @adminKey)`);

        // Insert participants and capture their DB ids
        const participantIds: number[] = [];
        for (const p of participants) {
          const r = new sql.Request(transaction);
          const result = await r
            .input('drawId', sql.UniqueIdentifier, drawId)
            .input('name', sql.NVarChar(200), p.name)
            .input('email', sql.NVarChar(320), p.email || null)
            .input('group_name', sql.NVarChar(200), p.group || null)
            .query(
              `INSERT INTO Participants (draw_id, name, email, group_name)
               OUTPUT INSERTED.id
               VALUES (@drawId, @name, @email, @group_name)`
            );
          participantIds.push(result.recordset[0].id);
        }

        // Build a map from participant name to DB id
        const nameToId: Record<string, number> = {};
        for (let i = 0; i < participants.length; i++) {
          nameToId[participants[i].name] = participantIds[i];
        }

        // Insert matches
        for (const match of matches) {
          const r = new sql.Request(transaction);
          await r
            .input('drawId', sql.UniqueIdentifier, drawId)
            .input('giverId', sql.Int, nameToId[match.giver.name])
            .input('receiverId', sql.Int, nameToId[match.receiver.name])
            .query(
              `INSERT INTO Matches (draw_id, giver_participant_id, receiver_participant_id)
               VALUES (@drawId, @giverId, @receiverId)`
            );
        }

        await transaction.commit();
        return { drawId, adminKey };
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }
}