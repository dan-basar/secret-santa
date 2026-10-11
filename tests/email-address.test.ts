import { describe, it, expect } from 'vitest';
import { isValidEmail } from '@/lib/email-address';

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const email of ['alex@example.com', 'first.last+tag@mail.example.co.uk', 'o’brien@example.ie']) {
      expect(isValidEmail(email), email).toBe(true);
    }
  });

  it('rejects addresses missing a part', () => {
    for (const email of ['', 'alex', 'alex@', '@example.com', 'alex@example', 'alex@@example.com']) {
      expect(isValidEmail(email), email).toBe(false);
    }
  });

  it('rejects whitespace, angle brackets and quotes', () => {
    for (const email of [
      'alex @example.com',
      ' alex@example.com',
      'alex@example.com\n',
      '<alex@example.com>',
      'Alex <alex@example.com>',
      '"alex"@example.com',
      "alex'@example.com",
    ]) {
      expect(isValidEmail(email), email).toBe(false);
    }
  });
});
