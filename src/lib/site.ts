import config from './base-path.json';

/**
 * The path prefix every page and API route is served under. It lives in
 * base-path.json, a format both next.config.js (plain JS) and TypeScript can
 * read, so this is its only definition. On the client, router.basePath gives
 * the same value.
 */
export const BASE_PATH: string = config.basePath;

/**
 * Public URL of a page on this site. NEXT_PUBLIC_BASE_URL is the site origin;
 * BASE_PATH is added here, and stripped first if the setting already ends with
 * it, so it is never doubled.
 */
export function siteUrl(path = ''): string {
  let origin = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (origin.endsWith(BASE_PATH)) origin = origin.slice(0, -BASE_PATH.length);
  return `${origin}${BASE_PATH}${path}`;
}

/** Public URL of a participant's private reveal page */
export function revealUrl(revealToken: string): string {
  return siteUrl(`/reveal/${encodeURIComponent(revealToken)}`);
}

/** Public URL of the organizer's page; the admin key rides in the fragment */
export function organizerUrl(adminKey: string): string {
  return siteUrl(`/draw#${encodeURIComponent(adminKey)}`);
}
