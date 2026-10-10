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
 * Normalizes a group name for comparison: "Family", "family" and " FAMILY "
 * are the same group. An empty result means the participant has no group.
 */
export function normalizeGroup(group: string): string {
  return group.trim().toLowerCase();
}

/**
 * Gives each participant a constraint key: participants with the same key
 * cannot be matched. Members of a named group share their group's key, and
 * each ungrouped participant gets a key of their own, which makes the
 * no-self-match rule the same rule as the no-same-group rule.
 */
function constraintKeys(participants: Participant[]): number[] {
  const groupKeys = new Map<string, number>();
  return participants.map((p, i) => {
    const g = normalizeGroup(p.group);
    if (!g) return participants.length + i;
    if (!groupKeys.has(g)) groupKeys.set(g, groupKeys.size);
    return groupKeys.get(g)!;
  });
}

/**
 * Checks whether a valid matching is mathematically possible.
 *
 * Each group member needs a receiver from outside the group and a giver from
 * outside the group, so a valid matching exists exactly when no group holds
 * more than half the participants (Hall's theorem; see backtrackMatch()).
 * Groups are compared case-insensitively, the same way createMatches() does.
 */
export function isMatchingPossible(participants: Participant[]): {
  possible: boolean;
  reason?: string;
} {
  const n = participants.length;
  if (n < 2) {
    return { possible: false, reason: 'At least 2 participants are required.' };
  }

  // Count group sizes (only for named groups — ungrouped participants are unconstrained).
  // The first spelling seen is used in error messages.
  const groupCounts = new Map<string, { label: string; count: number }>();
  for (const p of participants) {
    const g = normalizeGroup(p.group);
    if (g) {
      const entry = groupCounts.get(g) ?? { label: p.group.trim(), count: 0 };
      entry.count++;
      groupCounts.set(g, entry);
    }
  }

  for (const { label, count } of groupCounts.values()) {
    if (count >= n) {
      return {
        possible: false,
        reason: `All participants are in group "${label}". No valid matches can be made.`,
      };
    }
    if (count > n / 2) {
      return {
        possible: false,
        reason: `Group "${label}" has too many members (${count} out of ${n}). A valid matching is impossible because there aren't enough people outside this group.`,
      };
    }
  }

  return { possible: true };
}

/**
 * Creates a valid matching. Participants are compared by position, not by
 * name, so two people with the same name are still matched as two people.
 * The returned matches hold the same object references that were passed in.
 * Returns null only when isMatchingPossible() would return false.
 */
export function createMatches(participants: Participant[]): Match[] | null {
  const keys = constraintKeys(participants);
  const toMatches = (receivers: number[]) =>
    receivers.map((ri, gi) => ({ giver: participants[gi], receiver: participants[ri] }));

  // Phase 1: uniform shuffle-and-verify. When an attempt succeeds the result
  // is uniformly random over all valid matchings. Draws with one large group
  // rarely produce a valid shuffle, which phase 2 handles.
  const MAX_ATTEMPTS = 1000;
  const indices = Array.from({ length: participants.length }, (_, i) => i);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const receivers = shuffle(indices);
    if (receivers.every((ri, gi) => keys[ri] !== keys[gi])) return toMatches(receivers);
  }

  // Phase 2: randomized backtracking with a feasibility check
  const receivers = backtrackMatch(keys);
  return receivers && toMatches(receivers);
}

/**
 * Randomized matcher that assigns a receiver to each giver in turn.
 *
 * Giver i may give to receiver j when keys[i] !== keys[j]. By Hall's theorem
 * the remaining givers and receivers can still be matched exactly when, for
 * every key, the remaining givers with that key are no more than the
 * remaining receivers without it. Each candidate receiver is checked against
 * that condition before it is taken, so the search never walks into a dead
 * end and runs in polynomial time instead of backtracking exponentially.
 * Candidates are tried in shuffled order so the result is still random.
 */
function backtrackMatch(keys: number[]): number[] | null {
  const n = keys.length;
  const giversLeft = new Map<number, number>();
  const receiversLeft = new Map<number, number>();
  for (const k of keys) {
    giversLeft.set(k, (giversLeft.get(k) ?? 0) + 1);
    receiversLeft.set(k, (receiversLeft.get(k) ?? 0) + 1);
  }

  const feasible = (remaining: number) => {
    for (const [k, givers] of giversLeft) {
      if (givers > remaining - (receiversLeft.get(k) ?? 0)) return false;
    }
    return true;
  };

  if (!feasible(n)) return null;

  const used = new Set<number>();
  const result: number[] = [];
  for (let gi = 0; gi < n; gi++) {
    const remaining = n - gi - 1;
    giversLeft.set(keys[gi], giversLeft.get(keys[gi])! - 1);

    const receiver = shuffle(Array.from({ length: n }, (_, i) => i)).find(ri => {
      if (used.has(ri) || keys[ri] === keys[gi]) return false;
      receiversLeft.set(keys[ri], receiversLeft.get(keys[ri])! - 1);
      if (feasible(remaining)) return true;
      receiversLeft.set(keys[ri], receiversLeft.get(keys[ri])! + 1);
      return false;
    });

    // Unreachable while the feasibility check above held, kept as a guard
    if (receiver === undefined) return null;
    used.add(receiver);
    result.push(receiver);
  }

  return result;
}

/**
 * Uniform Fisher-Yates shuffle. Returns a new shuffled array.
 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
