import sanitize from 'sanitize-html';

/**
 * Strip ALL HTML from a string. Returns plain text only.
 * Used for participant names, group names, and any other user-provided
 * text that will be rendered in emails or the UI.
 */
export function stripHtml(input: string): string {
  return sanitize(input, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}
