import { describe, expect, it } from 'vitest';
import {
  formatCidDisplay,
  getInitialCredentialFromCid,
  isScientificNotation,
  maskCid,
  toArabicDigits,
  validateCid,
} from '@/lib/cidValidator';

function makeValidCid(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return `${first12}${check}`;
}

describe('cidValidator', () => {
  const validCid = makeValidCid('110070123456');

  it('validates a legitimate 13-digit Thai CID using Mod 11', () => {
    const res = validateCid(validCid);
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe(validCid);
    expect(res.errorCode).toBeUndefined();
  });

  it('rejects a CID with an incorrect Mod 11 check digit', () => {
    const wrongLast = String((Number(validCid[12]) + 1) % 10);
    const invalidCid = `${validCid.slice(0, 12)}${wrongLast}`;
    const res = validateCid(invalidCid);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toBe('CID_MOD11_FAILED');
  });

  it('detects Excel scientific notation (CID_SCIENTIFIC)', () => {
    expect(isScientificNotation('3.10E+12')).toBe(true);
    const res = validateCid('3.10E+12');
    expect(res.valid).toBe(false);
    expect(res.errorCode).toBe('CID_SCIENTIFIC');
  });

  it('converts Thai numerals to Arabic digits and validates cleanly', () => {
    const thaiMap = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
    const thaiCid = validCid
      .split('')
      .map((d) => thaiMap[Number(d)])
      .join('');
    const converted = toArabicDigits(thaiCid);
    expect(converted.converted).toBe(true);
    expect(converted.value).toBe(validCid);

    const res = validateCid(thaiCid);
    expect(res.valid).toBe(true);
    expect(res.convertedThaiDigits).toBe(true);
    expect(res.normalized).toBe(validCid);
  });

  it('rejects empty or invalid length CIDs', () => {
    expect(validateCid('').errorCode).toBe('REQUIRED');
    expect(validateCid('12345').errorCode).toBe('CID_INVALID_LENGTH');
  });

  it('masks CID according to PDPA and extracts initial 6-digit credential', () => {
    expect(maskCid(validCid)).toBe(
      `${validCid[0]}-xxxx-xxxxx-${validCid.slice(10, 12)}-${validCid[12]}`
    );
    expect(formatCidDisplay(validCid)).toMatch(/^\d-\d{4}-\d{5}-\d{2}-\d$/);
    expect(getInitialCredentialFromCid(validCid)).toBe(validCid.slice(-6));
  });
});
