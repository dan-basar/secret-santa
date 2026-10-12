// Postgres rejects malformed uuid input with an error, so routes check the
// shape first and treat a bad id as "not found" / bad input instead of a 500.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
