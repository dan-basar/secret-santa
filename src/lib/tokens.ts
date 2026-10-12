// The secrets in the organizer's and participants' links: random letters and
// digits, short enough to paste into a text. Each character is one of 62, so
// 14 characters are about 83 random bits and 8 about 48. The organizer key
// unlocks a whole draw, including email addresses, so it gets the longer one.
// Page lookups are rate limited per IP (src/proxy.ts), which keeps guessing slow.
// It uses the Web Crypto API, so pages can import the shape checks too
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const ADMIN_KEY_LENGTH = 14;
export const REVEAL_TOKEN_LENGTH = 8;

const TOKEN_CHARS = /^[0-9A-Za-z]+$/;

/** A random token of `length` characters from ALPHABET, each equally likely */
export function newToken(length: number): string {
  let token = '';
  while (token.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      // 248 is the largest multiple of 62 below 256; skipping bytes from 248 up
      // keeps every character equally likely
      if (byte < 248 && token.length < length) token += ALPHABET[byte % 62];
    }
  }
  return token;
}

export function isAdminKey(value: string): boolean {
  return value.length === ADMIN_KEY_LENGTH && TOKEN_CHARS.test(value);
}

export function isRevealToken(value: string): boolean {
  return value.length === REVEAL_TOKEN_LENGTH && TOKEN_CHARS.test(value);
}

/** Letters and digits, but too few of them: almost always a link cut short when pasted */
export function isCutShort(value: string, length: number): boolean {
  return value.length < length && (value === '' || TOKEN_CHARS.test(value));
}
