/**
 * Public URL of a page on this site. NEXT_PUBLIC_BASE_URL is the site origin;
 * the /secret-santa basePath is added here, and stripped first if the setting
 * already ends with it, so it is never doubled.
 */
export function siteUrl(path = ''): string {
  const origin = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '').replace(/\/secret-santa$/, '');
  return `${origin}/secret-santa${path}`;
}
