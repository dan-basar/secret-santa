// The yearly holiday change freeze (docs/OPERATIONS.md): from 3am Eastern on the Tuesday before
// US Thanksgiving until 3am Eastern on 2 January. Eastern is on standard time (UTC-5) for the
// whole window, so both edges are 08:00 UTC.

export interface FreezeWindow {
  start: Date;
  end: Date;
}

// Thanksgiving is the fourth Thursday of November, so the Tuesday before it falls on 20-26 November
export function freezeStart(year: number): Date {
  const firstOfNovember = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - firstOfNovember + 7) % 7);
  return new Date(Date.UTC(year, 10, firstThursday + 21 - 2, 8));
}

export function freezeEnd(year: number): Date {
  return new Date(Date.UTC(year, 0, 2, 8));
}

// The freeze `now` falls in, or null outside one
export function currentFreeze(now: Date): FreezeWindow | null {
  const year = now.getUTCFullYear();
  if (now < freezeEnd(year)) return { start: freezeStart(year - 1), end: freezeEnd(year) };
  if (now >= freezeStart(year)) return { start: freezeStart(year), end: freezeEnd(year + 1) };
  return null;
}
