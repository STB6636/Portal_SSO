import { describe, expect, it } from 'vitest';
import {
  cleanDisplaySegment,
  formatCivilServantPosition,
  formatOrgDisplay,
  formatThaiFullName,
  isMeaninglessDisplayValue,
  mergeExecutiveTitleWithOrg,
  resolveExecutiveTargetOrgName,
} from '@/lib/positionFormatter';

describe('positionFormatter', () => {
  it('concatenates standard civil servant position and level without duplicate suffix', () => {
    expect(formatCivilServantPosition('นักวิชาการคอมพิวเตอร์', 'ชำนาญการ', 'วิชาการ')).toBe(
      'นักวิชาการคอมพิวเตอร์ชำนาญการ'
    );
    expect(formatCivilServantPosition('นักวิชาการคอมพิวเตอร์ชำนาญการ', 'ชำนาญการ', 'วิชาการ')).toBe(
      'นักวิชาการคอมพิวเตอร์ชำนาญการ'
    );
    expect(formatCivilServantPosition('พนักงานขับรถยนต์', 'ไม่มีระดับ', 'ลูกจ้างประจำ')).toBe(
      'พนักงานขับรถยนต์'
    );
    expect(formatCivilServantPosition('', '')).toBe('-');
  });

  it('formats all 7 BMA executive / managerial / unit-head examples with Lv1–Lv4 org suffix and no "ระดับ..." suffix', () => {
    // 1. Lv1: ผู้อำนวยการสำนัก + สำนักเทศกิจ -> ผู้อำนวยการสำนักเทศกิจ
    expect(
      formatCivilServantPosition('ผู้อำนวยการสำนัก', 'บริหารสูง', 'ประเภทบริหาร', {
        positionTypeCode: 'EXECUTIVE',
        bureauName: 'สำนักเทศกิจ',
      })
    ).toBe('ผู้อำนวยการสำนักเทศกิจ');

    // 2. Lv1: รองผู้อำนวยการสำนัก + สำนักเทศกิจ -> รองผู้อำนวยการสำนักเทศกิจ
    expect(
      formatCivilServantPosition('รองผู้อำนวยการสำนัก', 'บริหารต้น', 'ประเภทบริหาร', {
        positionTypeCode: 'EXECUTIVE',
        bureauName: 'สำนักเทศกิจ',
      })
    ).toBe('รองผู้อำนวยการสำนักเทศกิจ');

    // 3. Lv1: เลขานุการสำนัก + สำนักเทศกิจ -> เลขานุการสำนักเทศกิจ (even if office/dept exist)
    expect(
      formatCivilServantPosition('เลขานุการสำนัก', 'อำนวยการสูง', 'ประเภทอำนวยการ', {
        positionTypeCode: 'MANAGERIAL',
        bureauName: 'สำนักเทศกิจ',
        officeName: 'สำนักงานเลขานุการ',
      })
    ).toBe('เลขานุการสำนักเทศกิจ');

    // 4. Lv2: ผู้อำนวยการสำนักงาน + สำนักงานตรวจและบังคับการ -> ผู้อำนวยการสำนักงานตรวจและบังคับการ (longest-prefix-first!)
    expect(
      formatCivilServantPosition('ผู้อำนวยการสำนักงาน', 'อำนวยการสูง', 'ประเภทอำนวยการ', {
        positionTypeCode: 'MANAGERIAL',
        bureauName: 'สำนักเทศกิจ',
        officeName: 'สำนักงานตรวจและบังคับการ',
      })
    ).toBe('ผู้อำนวยการสำนักงานตรวจและบังคับการ');

    // 5. Lv2: ผู้อำนวยการกอง + กองนโยบายและแผนงาน -> ผู้อำนวยการกองนโยบายและแผนงาน
    expect(
      formatCivilServantPosition('ผู้อำนวยการกอง', 'อำนวยการต้น', 'ประเภทอำนวยการ', {
        positionTypeCode: 'MANAGERIAL',
        bureauName: 'สำนักเทศกิจ',
        officeName: 'กองนโยบายและแผนงาน',
      })
    ).toBe('ผู้อำนวยการกองนโยบายและแผนงาน');

    // 6. Lv3: ผู้อำนวยการส่วน + ส่วนตรวจและบังคับการ 1 -> ผู้อำนวยการส่วนตรวจและบังคับการ 1
    expect(
      formatCivilServantPosition('ผู้อำนวยการส่วน', 'อำนวยการต้น', 'ประเภทอำนวยการ', {
        positionTypeCode: 'MANAGERIAL',
        bureauName: 'สำนักเทศกิจ',
        officeName: 'สำนักงานตรวจและบังคับการ',
        departmentName: 'ส่วนตรวจและบังคับการ 1',
      })
    ).toBe('ผู้อำนวยการส่วนตรวจและบังคับการ 1');

    // 7. Lv3: หัวหน้าฝ่าย + ฝ่ายบริหารงานทั่วไป -> หัวหน้าฝ่ายบริหารงานทั่วไป (even under วิชาการ/ทั่วไป!)
    expect(
      formatCivilServantPosition('หัวหน้าฝ่าย', 'ชำนาญการพิเศษ', 'ประเภทวิชาการ', {
        positionTypeCode: 'ACADEMIC',
        bureauName: 'สำนักเทศกิจ',
        officeName: 'สำนักงานเลขานุการ',
        departmentName: 'ฝ่ายบริหารงานทั่วไป',
      })
    ).toBe('หัวหน้าฝ่ายบริหารงานทั่วไป');

    // 8. Lv4: หัวหน้ากลุ่มงาน + กลุ่มงานปฏิบัติการ -> หัวหน้ากลุ่มงานปฏิบัติการ
    expect(
      formatCivilServantPosition('หัวหน้ากลุ่มงาน', 'ชำนาญการพิเศษ', 'ประเภทวิชาการ', {
        divisionName: 'กลุ่มงานปฏิบัติการ',
      })
    ).toBe('หัวหน้ากลุ่มงานปฏิบัติการ');
  });

  it('handles edge cases: fallbackBureauName, no-prefix org name, idempotency, and missing org context', () => {
    // Fallback bureau name when bureauName is blank
    expect(
      formatCivilServantPosition('ผู้อำนวยการสำนัก', 'บริหารสูง', 'ประเภทบริหาร', {
        fallbackBureauName: 'สำนักเทศกิจ',
      })
    ).toBe('ผู้อำนวยการสำนักเทศกิจ');

    // Org name without leading prefix (e.g., "เทศกิจ" instead of "สำนักเทศกิจ")
    expect(mergeExecutiveTitleWithOrg('ผู้อำนวยการสำนัก', 'เทศกิจ')).toBe('ผู้อำนวยการสำนักเทศกิจ');
    expect(mergeExecutiveTitleWithOrg('ผู้อำนวยการกอง', 'นโยบายและแผนงาน')).toBe('ผู้อำนวยการกองนโยบายและแผนงาน');

    // Idempotent when position name already includes the org name
    expect(mergeExecutiveTitleWithOrg('ผู้อำนวยการสำนักเทศกิจ', 'สำนักเทศกิจ')).toBe('ผู้อำนวยการสำนักเทศกิจ');

    // Missing org context: returns clean base title WITHOUT "ระดับ..." suffix (Checkpoint 1A-1)
    expect(formatCivilServantPosition('ผู้อำนวยการสำนักงาน', 'สูง', 'อำนวยการ')).toBe('ผู้อำนวยการสำนักงาน');
    expect(resolveExecutiveTargetOrgName('ผู้อำนวยการสำนักงาน', null, null, {}).targetOrg).toBe('');
  });

  it('formats Thai full name with prefix and optional rank', () => {
    expect(formatThaiFullName({ prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' })).toBe('นายสมชาย ใจดี');
    expect(
      formatThaiFullName({
        nobleOrRank: 'ว่าที่ ร.ต.',
        prefix: '',
        firstName: 'สมหญิง',
        lastName: 'รักชาติ',
      })
    ).toBe('ว่าที่ ร.ต.สมหญิง รักชาติ');
  });

  it('suppresses meaningless "ไม่มี" / "ไม่มีระดับ" / "ไม่ระบุ" / "-" tokens in positions and org displays', () => {
    expect(isMeaninglessDisplayValue('ไม่มี')).toBe(true);
    expect(isMeaninglessDisplayValue('ไม่มีระดับ')).toBe(true);
    expect(isMeaninglessDisplayValue('ไม่ระบุ')).toBe(true);
    expect(isMeaninglessDisplayValue('-')).toBe(true);
    expect(cleanDisplaySegment('ไม่มี')).toBe('');
    expect(cleanDisplaySegment('สำนักงานเลขานุการ')).toBe('สำนักงานเลขานุการ');

    expect(formatCivilServantPosition('นักวิชาการ', 'ไม่มี', 'ประเภทวิชาการ')).toBe('นักวิชาการ');
    expect(
      formatCivilServantPosition('หัวหน้าฝ่าย', 'ชำนาญการ', 'ประเภทวิชาการ', {
        officeName: 'สำนักงานเลขานุการ',
        departmentName: 'ไม่มี',
      })
    ).toBe('หัวหน้าฝ่าย');

    const org1 = formatOrgDisplay({
      officeName: 'สำนักงานเลขานุการ',
      departmentName: 'ไม่มี',
      divisionName: '-',
    });
    expect(org1.primary).toBe('สำนักงานเลขานุการ');
    expect(org1.secondary).toBe('');
    expect(org1.full).toBe('สำนักงานเลขานุการ');

    const orgEmpty = formatOrgDisplay({
      officeName: 'ไม่มี',
      departmentName: 'ไม่ระบุ',
    });
    expect(orgEmpty.full).toBe('');
  });
});
