/**
 * True if the string contains something that looks like an HTML tag,
 * comment or doctype (e.g. "<b>", "</p>", "<!-- x -->").
 * Names, group names and organizer names are stored as plain text exactly as
 * typed, so "Tom & Jerry" or "<3" are fine; only markup is rejected.
 * React escapes stored values on screen and escapeHtml() escapes them in emails.
 */
export function hasHtmlTag(input: string): boolean {
  return /<\/?[a-z!][^>]*>/i.test(input);
}

/**
 * Escape plain text for placement in HTML element content or a quoted attribute.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
