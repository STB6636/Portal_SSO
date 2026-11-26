import { describe, expect, it } from 'vitest';
import {
  extractBangkokIsoDate,
  formatThaiDate,
  formatThaiDateTime,
  getCurrentYearBeBangkok,
  getRetirementDateInfo,
  getRetirementFiscalYearBE,
  getTodayBeFileTag,
  getTodayIsoBangkok,
  isoDateToBangkokEndOfDayIso,
  parseThaiDateInput,
} from '@/lib/thaiDate';

describe('thaiDate — Buddhist Era (พ.ศ.) & Asia/Bangkok utilities', () => {
  describe('formatThaiDate', () => {
    it('formats ISO CE date into numeric, short, and long Buddhist Era strings', () => {
      expect(formatThaiDate('2026-10-01', 'numeric')).toBe('01/10/2569');
      expect(formatThaiDate('2026-10-01', 'short')).toBe('1 ต.ค. 2569');
      expect(formatThaiDate('2026-10-01', 'long')).toBe('1 ตุลาคม 2569');
    });

    it('handles leap day 29 Feb accurately', () => {
      expect(formatThaiDate('2024-02-29', 'numeric')).toBe('29/02/2567');
      expect(formatThaiDate('2024-02-29', 'long')).toBe('29 กุมภาพันธ์ 2567');
    });

    it('returns empty string for null, empty, or invalid inputs', () => {
      expect(formatThaiDate(null)).toBe('');
      expect(formatThaiDate(undefined)).toBe('');
      expect(formatThaiDate('')).toBe('');
      expect(formatThaiDate('2025-02-29')).toBe('');
      expect(formatThaiDate('not-a-date')).toBe('');
    });

    it('converts UTC TIMESTAMPTZ near midnight into Asia/Bangkok date accurately', () => {
      // 2026-09-30T17:30:00Z is 2026-10-01 00:30:00 in Asia/Bangkok (+07:00)
      expect(formatThaiDate('2026-09-30T17:30:00Z', 'numeric')).toBe('01/10/2569');
    });
  });

  describe('formatThaiDateTime', () => {
    it('formats UTC timestamp locked to Asia/Bangkok (+07:00) in BE', () => {
      expect(formatThaiDateTime('2026-11-24T06:45:00Z')).toBe('24 พ.ย. 2569 13:45 น.');
      expect(formatThaiDateTime('2026-11-24T06:45:09Z', { showSeconds: true })).toBe(
        '24 พ.ย. 2569 13:45:09 น.'
      );
      expect(formatThaiDateTime('2026-11-24T17:05:00Z')).toBe('25 พ.ย. 2569 00:05 น.');
    });

    it('returns empty string on invalid input', () => {
      expect(formatThaiDateTime(null)).toBe('');
      expect(formatThaiDateTime('invalid')).toBe('');
    });
  });

  describe('parseThaiDateInput', () => {
    it('parses DD/MM/BBBB Buddhist Era strings', () => {
      const res = parseThaiDateInput('01/10/2569');
      expect(res).toEqual({
        isoCe: '2026-10-01',
        displayBe: '01/10/2569',
        yearBe: 2569,
        yearCe: 2026,
        month: 10,
        day: 1,
        convertedCeToBe: false,
        convertedThaiDigits: false,
      });
    });

    it('converts Thai numerals (๐-๙) to Arabic digits automatically', () => {
      const res = parseThaiDateInput('๑๕/๐๕/๒๕๓๐');
      expect(res?.isoCe).toBe('1987-05-15');
      expect(res?.displayBe).toBe('15/05/2530');
      expect(res?.convertedThaiDigits).toBe(true);
      expect(res?.convertedCeToBe).toBe(false);
    });

    it('auto-converts CE years (1900-2200) to BE', () => {
      const res = parseThaiDateInput('1987-05-15');
      expect(res?.isoCe).toBe('1987-05-15');
      expect(res?.displayBe).toBe('15/05/2530');
      expect(res?.yearBe).toBe(2530);
      expect(res?.convertedCeToBe).toBe(true);

      const dmyCe = parseThaiDateInput('15-05-1987');
      expect(dmyCe?.isoCe).toBe('1987-05-15');
      expect(dmyCe?.convertedCeToBe).toBe(true);
    });

    it('validates leap years strictly (allows 29/02/2567 BE = 2024 CE, rejects 29/02/2568 BE = 2025 CE)', () => {
      expect(parseThaiDateInput('29/02/2567')?.isoCe).toBe('2024-02-29');
      expect(parseThaiDateInput('29/02/2568')).toBeNull();
      expect(parseThaiDateInput('31/04/2569')).toBeNull();
      expect(parseThaiDateInput('01/13/2569')).toBeNull();
      expect(parseThaiDateInput('01/10/1800')).toBeNull();
      expect(parseThaiDateInput('')).toBeNull();
    });
  });

  describe('Asia/Bangkok timezone helpers', () => {
    it('extractBangkokIsoDate avoids UTC off-by-one bug', () => {
      // 2026-09-30T16:59:59.000Z is 2026-09-30 23:59:59+07:00
      expect(extractBangkokIsoDate('2026-09-30T16:59:59.000Z')).toBe('2026-09-30');
      // 2026-09-30T17:00:00.000Z is 2026-10-01 00:00:00+07:00 (slice(0,10) would wrongly return 2026-09-30!)
      expect(extractBangkokIsoDate('2026-09-30T17:00:00.000Z')).toBe('2026-10-01');
      // Pure YYYY-MM-DD passes through unchanged only if valid calendar date
      expect(extractBangkokIsoDate('2026-10-01')).toBe('2026-10-01');
      expect(extractBangkokIsoDate('2026-02-30')).toBe('');
      expect(extractBangkokIsoDate('2025-02-29')).toBe('');
      expect(extractBangkokIsoDate(null)).toBe('');
    });

    it('isoDateToBangkokEndOfDayIso locks expiry to 23:59:59+07:00', () => {
      expect(isoDateToBangkokEndOfDayIso('2026-09-30')).toBe('2026-09-30T16:59:59.000Z');
      expect(isoDateToBangkokEndOfDayIso('2026-10-01')).toBe('2026-10-01T16:59:59.000Z');
      // Round-trip: isoDateToBangkokEndOfDayIso -> extractBangkokIsoDate returns the exact same date
      const eod = isoDateToBangkokEndOfDayIso('2026-09-30');
      expect(extractBangkokIsoDate(eod)).toBe('2026-09-30');
      // Invalid input returns null
      expect(isoDateToBangkokEndOfDayIso('')).toBeNull();
      expect(isoDateToBangkokEndOfDayIso('2025-02-29')).toBeNull();
    });

    it('getTodayIsoBangkok, getTodayBeFileTag, and getCurrentYearBeBangkok use Asia/Bangkok', () => {
      // 2026-12-31T18:00:00Z is already 2027-01-01 01:00:00 in Bangkok!
      const utcNewYearsEveNight = new Date('2026-12-31T18:00:00Z');
      expect(getTodayIsoBangkok(utcNewYearsEveNight)).toBe('2027-01-01');
      expect(getTodayBeFileTag(utcNewYearsEveNight)).toBe('2570-01-01');
      expect(getCurrentYearBeBangkok(utcNewYearsEveNight)).toBe(2570);
    });
  });

  describe('BMA October 1st Retirement Rule (Section 5.3)', () => {
    it('born Jan 1 – Oct 1 (inclusive) retires in birthYearBE + 60', () => {
      // Born 1966-01-01 (2509 BE) -> retires fiscal year 2569
      expect(getRetirementFiscalYearBE('1966-01-01')).toBe(2569);
      // Born 1966-09-30 (2509 BE) -> retires fiscal year 2569
      expect(getRetirementFiscalYearBE('1966-09-30')).toBe(2569);
      // Critical edge case: Born 1966-10-01 (1 ตุลาคม 2509) -> STILL retires fiscal year 2569!
      expect(getRetirementFiscalYearBE('1966-10-01')).toBe(2569);
      expect(getRetirementDateInfo('1966-10-01')).toEqual({
        fiscalYearBe: 2569,
        retirementDateIso: '2026-09-30',
        retirementDateShort: '30 ก.ย. 2569',
      });
    });

    it('born Oct 2 – Dec 31 retires in birthYearBE + 61', () => {
      // Critical edge case: Born 1966-10-02 (2 ตุลาคม 2509) -> retires fiscal year 2570!
      expect(getRetirementFiscalYearBE('1966-10-02')).toBe(2570);
      expect(getRetirementFiscalYearBE('1966-12-31')).toBe(2570);
      expect(getRetirementDateInfo('1966-10-02')).toEqual({
        fiscalYearBe: 2570,
        retirementDateIso: '2027-09-30',
        retirementDateShort: '30 ก.ย. 2570',
      });
    });

    it('returns null for empty or invalid birth dates', () => {
      expect(getRetirementFiscalYearBE('')).toBeNull();
      expect(getRetirementFiscalYearBE(null)).toBeNull();
      expect(getRetirementDateInfo('invalid')).toBeNull();
    });
  });
});
