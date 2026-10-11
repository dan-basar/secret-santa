// No whitespace, "<", ">" or quotes anywhere: those have no place in an address
// that is shown inside an email. Deliberately loose otherwise; Gmail decides
// whether an address really exists.
const EMAIL_REGEX = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/**
 * True if the string looks like a single email address. Callers trim first.
 * Shared by the home form, the organizer form, create-draw and send-emails so
 * the browser and the server never disagree.
 */
export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}
