// Two people called "Sam" would be matched correctly (matches go by position), but
// the reveal page and email would then say "you're the Secret Santa for Sam" with no
// way to tell which one. So names must differ once case and spaces are ignored.
// Shared by the home form and create-draw.
function nameKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

// Each name that appears more than once, as first typed (trimmed), in order
export function duplicateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  for (const name of names) {
    const key = nameKey(name);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const reported = new Set<string>();
  const duplicates: string[] = [];
  for (const name of names) {
    const key = nameKey(name);
    if ((seen.get(key) ?? 0) > 1 && !reported.has(key)) {
      reported.add(key);
      duplicates.push(name.trim());
    }
  }
  return duplicates;
}

export function duplicateNamesMessage(duplicates: string[]): string {
  return `Names must be distinguishable. Each of these is used more than once: ${duplicates.join(', ')}. Add a last initial or nickname, like "Sam L."`;
}
