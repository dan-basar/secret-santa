import { describe, it, expect } from 'vitest';
import { duplicateNames } from '@/lib/names';

describe('duplicateNames', () => {
  it('finds names equal ignoring case and spaces, each once, as first typed', () => {
    expect(duplicateNames(['Sam', 'Alex', ' SAM ', 'Mary Ann', 'maryann', 'sam'])).toEqual(['Sam', 'Mary Ann']);
  });

  it('lets names that really differ through', () => {
    expect(duplicateNames(['Sam', 'Sam L.', 'Samantha'])).toEqual([]);
  });
});
