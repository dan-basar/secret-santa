import { describe, it, expect } from 'vitest';
import { newToken, isAdminKey, isRevealToken, isCutShort, ADMIN_KEY_LENGTH, REVEAL_TOKEN_LENGTH } from '@/lib/tokens';

describe('link tokens', () => {
  it('makes keys and tokens of letters and digits at their set lengths', () => {
    for (let i = 0; i < 200; i++) {
      expect(isAdminKey(newToken(ADMIN_KEY_LENGTH))).toBe(true);
      expect(isRevealToken(newToken(REVEAL_TOKEN_LENGTH))).toBe(true);
    }
  });

  it('uses all 62 characters', () => {
    const seen = new Set(Array.from({ length: 300 }, () => newToken(20)).join(''));
    expect(seen.size).toBe(62);
  });

  it('refuses the wrong length or other characters, including the old UUIDs', () => {
    expect(isRevealToken('Qx7bN2k')).toBe(false);
    expect(isRevealToken('Qx7bN2k-')).toBe(false);
    expect(isAdminKey('3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90')).toBe(false);
  });

  it('spots a link cut short, but not one that is malformed', () => {
    expect(isCutShort('', REVEAL_TOKEN_LENGTH)).toBe(true);
    expect(isCutShort('Qx7b', REVEAL_TOKEN_LENGTH)).toBe(true);
    expect(isCutShort('Qx7bN2kP', REVEAL_TOKEN_LENGTH)).toBe(false);
    expect(isCutShort('key=Qx', REVEAL_TOKEN_LENGTH)).toBe(false);
  });
});
