import { describe, expect, it } from 'vitest';
import { escapeHtml, hasHtmlTag } from '@/lib/sanitize';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;'
    );
  });

  it('escapes an existing entity again rather than passing it through', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Zoë Smith-Jones')).toBe('Zoë Smith-Jones');
  });
});

describe('hasHtmlTag', () => {
  it.each([
    '<b>Tom</b>',
    '</p>',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'Tom <br/> Jerry',
    '<!-- comment -->',
    '<!DOCTYPE html>',
  ])('rejects %s', input => {
    expect(hasHtmlTag(input)).toBe(true);
  });

  it.each([
    'Tom & Jerry',
    'Tom &amp; Jerry',
    'I <3 gifts',
    'a < b > c',
    '5 > 3',
    "O'Brien",
    '"Nick"',
  ])('allows %s', input => {
    expect(hasHtmlTag(input)).toBe(false);
  });
});
