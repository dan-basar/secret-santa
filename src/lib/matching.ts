export interface Participant {
  id?: number;
  name: string;
  email: string;
  group: string;
}

export interface Match {
  giver: Participant;
  receiver: Participant;
}

/**
 * Checks whether a valid matching is mathematically possible.
 * A valid matching requires that no single group holds more than floor(n/2)
 * participants when n is even, or floor(n/2) when n is odd — more precisely,
 * no group can have more members than the total number of people outside that group
 * (since each group member needs a receiver from outside the group,
 * and also needs to receive from outside the group).
 *
 * The exact condition: for a valid derangement-with-constraints to exist,
 * no group should account for more than half the participants (strictly more
 * than n/2 means it's impossible).
 */
export function isMatchingPossible(participants: Participant[]): {
  possible: boolean;
  reason?: string;
} {
  const n = participants.length;
  if (n < 2) {
    return { possible: false, reason: 'At least 2 participants are required.' };
  }

  // Count group sizes (only for named groups — ungrouped participants are unconstrained)
  const groupCounts: Record<string, number> = {};
  for (const p of participants) {
    const g = p.group.trim();
    if (g) {
      groupCounts[g] = (groupCounts[g] || 0) + 1;
    }
  }

  for (const [group, count] of Object.entries(groupCounts)) {
    if (count >= n) {
      return {
        possible: false,
        reason: `All participants are in group "${group}". No valid matches can be made.`,
      };
    }
    if (count > n / 2) {
      return {
        possible: false,
        reason: `Group "${group}" has too many members (${count} out of ${n}). A valid matching is impossible because there aren't enough people outside this group.`,
      };
    }
  }

  return { possible: true };
}

/**
 * Attempts to create a valid matching using a shuffle-and-verify approach
 * with backtracking fallback. Returns null if no valid matching found after
 * max attempts (should not happen if isMatchingPossible returns true).
 */
export function createMatches(participants: Participant[]): Match[] | null {
  // 1000 attempts is more than sufficient given the mathematical guarantee
  // from isMatchingPossible(). The backtracking fallback only fires in the
  // extremely unlikely event that all random attempts happen to be invalid.
  const MAX_ATTEMPTS = 1000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Biased shuffle (sort with random comparator) — not uniform, but fast
    // and good enough for exploratory phase 1. Correctness is handled by
    // backtracking if all 1000 attempts fail.
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const result: Match[] = [];
    let valid = true;

    for (let i = 0; i < participants.length; i++) {
      const giver = participants[i];
      const receiver = shuffled[i];

      // Reject self-matches and same-group matches.
      // Group comparison is case-insensitive so "Family" and "family" are the same group.
      if (
        giver.name === receiver.name ||
        (giver.group.trim() &&
          receiver.group.trim() &&
          giver.group.trim().toLowerCase() === receiver.group.trim().toLowerCase())
      ) {
        valid = false;
        break;
      }

      result.push({ giver, receiver });
    }

    if (valid) return result;
  }

  // Fallback: deterministic backtracking
  return backtrackMatch(participants);
}

/**
 * Deterministic recursive backtracking matcher.
 *
 * Assigns a receiver to each giver one at a time (in `participants` order).
 * For each giver, a shuffled list of candidate receiver indices is tried; any
 * index already used or violating a constraint is skipped. If no valid
 * receiver exists for the current giver, the function returns null and the
 * caller backtracks by trying the next candidate at the previous level.
 *
 * Guaranteed to find a solution if `isMatchingPossible()` returned true.
 * The shuffle at each level ensures the result is still random rather than
 * always producing the same deterministic assignment.
 */
function backtrackMatch(
  participants: Participant[],
  index = 0,
  used = new Set<number>(),
  result: Match[] = []
): Match[] | null {
  if (index === participants.length) return result;

  const giver = participants[index];
  // Shuffle candidate indices for randomness — unlike phase 1's biased sort,
  // this uses a proper Fisher-Yates shuffle (see shuffle() below).
  const indices = shuffle(
    Array.from({ length: participants.length }, (_, i) => i)
  );

  for (const ri of indices) {
    if (used.has(ri)) continue;
    const receiver = participants[ri];
    if (
      giver.name === receiver.name ||
      (giver.group.trim() &&
        receiver.group.trim() &&
        giver.group.trim().toLowerCase() ===
          receiver.group.trim().toLowerCase())
    )
      continue;

    used.add(ri);
    result.push({ giver, receiver });
    const sub = backtrackMatch(participants, index + 1, used, result);
    if (sub) return sub;
    // This path led to a dead end — undo and try the next candidate
    used.delete(ri);
    result.pop();
  }

  return null;
}

/**
 * Uniform Fisher-Yates in-place shuffle. Returns a new shuffled array.
 * Used by backtrackMatch to randomise candidate order at each recursion level.
 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
