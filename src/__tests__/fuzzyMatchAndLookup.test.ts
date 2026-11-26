import { describe, expect, it } from 'vitest';
import {
  findTopSuggestions,
  levenshteinDistance,
  normalizeLookupText,
  similarityScore,
} from '@/lib/fuzzy-match';

describe('fuzzy-match', () => {
  it('normalizes Thai whitespace, zero-width characters, and case', () => {
    expect(normalizeLookupText('  ฝ่าย\u200Bบริหาร   งานทั่วไป  ')).toBe('ฝ่ายบริหาร งานทั่วไป');
    expect(normalizeLookupText('  SUPER  Admin ')).toBe('super admin');
  });

  it('computes exact Levenshtein distance and high similarity scores', () => {
    expect(levenshteinDistance('เทศกิจ', 'เทศกิจ')).toBe(0);
    expect(levenshteinDistance('เทศกิจ', 'เทศกิต')).toBe(1);
    expect(similarityScore('เทศกิจ', 'เจ้าพนักงานเทศกิจ')).toBeGreaterThan(0.4);
  });

  it('returns Top-3 closest suggestions for Thai typos', () => {
    const candidates = [
      'เจ้าพนักงานเทศกิจ',
      'นักวิชาการคอมพิวเตอร์',
      'นักจัดการงานทั่วไป',
      'เจ้าพนักงานธุรการ',
      'เจ้าพนักงานการเงินและบัญชี',
      'นิติกร',
    ];
    const top = findTopSuggestions('เจ้าพนักงานเทศกิต', candidates, 3);
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top[0]).toBe('เจ้าพนักงานเทศกิจ');
  });
});
