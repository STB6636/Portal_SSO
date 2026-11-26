import { describe, expect, it } from 'vitest';
import {
  autoMapHeaders,
  decodeCsvArrayBuffer,
  parseClipboardTable,
} from '@/features/import-grid/CsvSmartReader';

describe('CsvSmartReader', () => {
  it('detects UTF-8 BOM and decodes Thai text cleanly', () => {
    const text = 'เลขบัตรประชาชน,ชื่อ,นามสกุล\n1100701234561,สมชาย,ใจดี';
    const utf8Bytes = new TextEncoder().encode(text);
    const withBom = new Uint8Array(utf8Bytes.length + 3);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(utf8Bytes, 3);

    const res = decodeCsvArrayBuffer(withBom.buffer, 'auto');
    expect(res.detectedEncoding).toBe('utf-8-bom');
    expect(res.text).toContain('สมชาย');
    expect(res.text.startsWith('\uFEFF')).toBe(false);
  });

  it('decodes plain UTF-8 without BOM', () => {
    const bytes = new TextEncoder().encode('ชื่อ,นามสกุล\nสมหญิง,รักดี');
    const res = decodeCsvArrayBuffer(bytes.buffer, 'auto');
    expect(res.detectedEncoding).toBe('utf-8');
    expect(res.text).toContain('สมหญิง');
  });

  it('falls back to Windows-874 (TIS-620) for legacy Thai Excel CSV bytes', () => {
    // Windows-874 bytes for "กขค" are [0xA1, 0xA2, 0xA4] (0xA3 is ฃ)
    const tisBytes = new Uint8Array([0xa1, 0xa2, 0xa4, 0x2c, 0xca, 0xc1, 0xaa, 0xd2, 0xc2]);
    const res = decodeCsvArrayBuffer(tisBytes.buffer, 'auto');
    expect(res.detectedEncoding).toBe('windows-874');
    expect(res.text).toContain('กขค');
    expect(res.text).toContain('สมชาย');
  });

  it('parses Google Sheets / Excel TSV clipboard paste with headers', () => {
    const tsv = 'เลขบัตรประชาชน\tชื่อ\tนามสกุล\n1100701234561\tสมชาย\tใจดี\n1100701234570\tสมหญิง\tรักไทย';
    const parsed = parseClipboardTable(tsv);
    expect(parsed.sourceFormat).toBe('CLIPBOARD');
    expect(parsed.headers).toEqual(['เลขบัตรประชาชน', 'ชื่อ', 'นามสกุล']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual(['1100701234561', 'สมชาย', 'ใจดี']);
  });

  it('auto-maps Thai and English headers to standard 28 ImportColumnKeys without duplicates', () => {
    const mappings = autoMapHeaders([
      'เลขประจำตัวประชาชน',
      'ชื่อจริง',
      'นามสกุล',
      'สำนักงาน/กอง',
      'ส่วน/ฝ่าย',
      'ปฏิบัติราชการแทน',
      'ไม่ทราบคอลัมน์XYZ',
    ]);
    expect(mappings[0].targetKey).toBe('cid');
    expect(mappings[1].targetKey).toBe('first_name');
    expect(mappings[2].targetKey).toBe('last_name');
    expect(mappings[3].targetKey).toBe('office_id');
    expect(mappings[4].targetKey).toBe('department_id');
    expect(mappings[5].targetKey).toBe('secondary_position');
    expect(mappings[6].targetKey).toBeNull();
  });
});
