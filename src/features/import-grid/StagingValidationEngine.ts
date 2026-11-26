import { toArabicDigits, validateCid } from '@/lib/cidValidator';
import { parseThaiDateInput } from '@/lib/thaiDate';
import { IMPORT_COLUMNS, createEmptyCells } from './importColumnsConfig';
import { RelationalHierarchyIndex } from './RelationalHierarchyIndex';
import type { ImportCommitMode } from '@/types/database.types';
import type { AdminScopeInfo } from '@/types/domain.types';
import type {
  CellValidationResult,
  ColumnMappingEntry,
  ExistingPersonnelSnapshot,
  ImportColumnKey,
  RowImportStatus,
  StagingRow,
} from '@/types/import.types';

export interface ValidationContext {
  index: RelationalHierarchyIndex;
  mode: ImportCommitMode;
  existingCidMap: Map<string, ExistingPersonnelSnapshot>;
  isSuperAdmin: boolean;
  adminScope: AdminScopeInfo | null;
}

function parseThaiOrIsoDate(rawInput: string) {
  return parseThaiDateInput(rawInput);
}

function parseSalaryNumber(raw: string): { value: number; convertedThaiDigits: boolean } | null {
  const { value: arabic, converted } = toArabicDigits(raw.trim());
  const cleaned = arabic.replace(/[,฿\s]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return { value: num, convertedThaiDigits: converted };
}

export function buildStagingRowsFromMapping(
  rawRows: string[][],
  mappings: ColumnMappingEntry[]
): StagingRow[] {
  return rawRows.map((rawRow, idx) => {
    const cells = createEmptyCells();
    for (const m of mappings) {
      if (m.targetKey) {
        cells[m.targetKey] = String(rawRow[m.sourceIndex] ?? '').trim();
      }
    }
    return {
      rowId: `row_${idx + 1}_${Math.random().toString(36).slice(2, 7)}`,
      sheetRowNo: idx + 2, // Row 1 is header
      selected: true,
      cells,
      resolved: {},
      validations: {},
      rowStatus: 'NEW',
      errorCount: 0,
      warningCount: 0,
      existingSnapshot: null,
    };
  });
}

/**
 * Validate all staged rows in-memory using O(1) RelationalHierarchyIndex.
 * Designed to process 2,000 rows in < 50ms.
 */
export function validateAllStagingRows(rows: StagingRow[], ctx: ValidationContext): StagingRow[] {
  const cidCountMap = new Map<string, number>();

  // Pass 1: count CIDs for duplicate detection
  for (const row of rows) {
    const cidRes = validateCid(row.cells.cid);
    if (cidRes.normalized.length === 13) {
      cidCountMap.set(cidRes.normalized, (cidCountMap.get(cidRes.normalized) || 0) + 1);
    }
  }

  // Pass 2: validate each row cleanly
  return rows.map((row) => validateSingleStagingRow(row, ctx, cidCountMap));
}

export function validateSingleStagingRow(
  row: StagingRow,
  ctx: ValidationContext,
  cidCountMap: Map<string, number>
): StagingRow {
  const { index, existingCidMap, isSuperAdmin, adminScope } = ctx;
  const cells = { ...row.cells };
  const resolved: Partial<Record<ImportColumnKey, string | number | boolean | null>> = {};
  const validations: Partial<Record<ImportColumnKey, CellValidationResult>> = {};

  const setVal = (key: ImportColumnKey, res: CellValidationResult) => {
    validations[key] = res;
  };

  // 1. CID (Required, Mod 11, No Scientific Notation, Duplicate Check)
  const cidCheck = validateCid(cells.cid);
  let existingSnapshot: ExistingPersonnelSnapshot | null = null;
  if (!cidCheck.valid) {
    resolved.cid = null;
    setVal('cid', {
      status: 'ERROR',
      code: cidCheck.errorCode,
      message: cidCheck.message,
    });
  } else if ((cidCountMap.get(cidCheck.normalized) || 0) > 1) {
    resolved.cid = cidCheck.normalized;
    setVal('cid', {
      status: 'ERROR',
      code: 'CID_DUPLICATE_IN_SHEET',
      message: 'พบเลขประจำตัวประชาชนซ้ำกันภายในไฟล์นี้ กรุณาตรวจสอบหรือลบแถวที่ซ้ำ',
    });
  } else {
    resolved.cid = cidCheck.normalized;
    existingSnapshot = existingCidMap.get(cidCheck.normalized) ?? null;
    if (existingSnapshot && !existingSnapshot.in_my_scope && !isSuperAdmin) {
      setVal('cid', {
        status: 'ERROR',
        code: 'OUT_OF_ADMIN_SCOPE',
        message: `เลขบัตรประชาชนนี้มีอยู่ในฐานข้อมูลแล้วในสังกัด "${existingSnapshot.office_name || '-'}" ซึ่งอยู่นอกขอบเขตของคุณ`,
      });
    } else if (cidCheck.convertedThaiDigits) {
      setVal('cid', {
        status: 'WARNING',
        code: 'AUTO_FIXED_THAI_DIGITS',
        message: 'แปลงเลขไทยเป็นเลขอารบิกอัตโนมัติ',
        normalizedValue: cidCheck.normalized,
      });
    } else {
      setVal('cid', { status: 'VALID', normalizedValue: cidCheck.normalized });
    }
  }

  // 3. First Name & Last Name (Required)
  const firstName = cells.first_name.trim();
  resolved.first_name = firstName || null;
  setVal(
    'first_name',
    firstName
      ? { status: 'VALID' }
      : { status: 'ERROR', code: 'REQUIRED', message: 'กรุณาระบุชื่อจริง' }
  );

  const lastName = cells.last_name.trim();
  resolved.last_name = lastName || null;
  setVal(
    'last_name',
    lastName
      ? { status: 'VALID' }
      : { status: 'ERROR', code: 'REQUIRED', message: 'กรุณาระบุนามสกุล' }
  );

  // Free-text optional fields
  resolved.noble_or_rank_title = cells.noble_or_rank_title.trim() || null;
  resolved.position_number = cells.position_number.trim() || null;
  resolved.secondary_position = cells.secondary_position.trim() || null;
  resolved.acting_position = cells.acting_position.trim() || null;
  resolved.initial_position = cells.initial_position.trim() || null;

  // 4. Generic Lookups (PREFIX, GENDER, EMPLOYMENT_TYPE, APPROVAL_TIER, PERSONNEL_STATUS)
  for (const col of IMPORT_COLUMNS) {
    if (col.kind !== 'lookup' || !col.lookupCategoryCode) continue;
    const raw = cells[col.key].trim();
    if (!raw) {
      if (col.key === 'status_id') {
        const defStatus = index.getDefaultLookup('PERSONNEL_STATUS');
        resolved.status_id = defStatus?.id ?? null;
      } else {
        resolved[col.key] = null;
      }
      setVal(col.key, { status: 'VALID' });
      continue;
    }

    const match = index.matchLookup(col.lookupCategoryCode, raw);
    if (match) {
      resolved[col.key] = match.item.id;
      if (match.matchedByShortOrCode) {
        setVal(col.key, {
          status: 'WARNING',
          code: 'AUTO_FIXED_PREFIX_SHORT',
          message: `จับคู่จากคำย่อ/รหัสเป็น "${match.item.name_th}" อัตโนมัติ`,
          resolvedId: match.item.id,
          normalizedValue: match.item.name_th,
        });
      } else {
        setVal(col.key, { status: 'VALID', resolvedId: match.item.id, normalizedValue: match.item.name_th });
      }
    } else {
      resolved[col.key] = null;
      setVal(col.key, {
        status: 'ERROR',
        code: 'LOOKUP_NOT_FOUND',
        message: `ไม่พบค่า "${raw}" ในฐานข้อมูล ${col.labelTh}`,
        suggestions: index.suggestLookup(col.lookupCategoryCode, raw, 3),
      });
    }
  }

  // 5. Birth Date
  const birthRaw = cells.birth_date.trim();
  if (!birthRaw) {
    resolved.birth_date = null;
    setVal('birth_date', { status: 'VALID' });
  } else {
    const parsed = parseThaiOrIsoDate(birthRaw);
    if (!parsed) {
      resolved.birth_date = null;
      setVal('birth_date', {
        status: 'ERROR',
        code: 'INVALID_DATE',
        message: 'รูปแบบวันที่ไม่ถูกต้อง (ตัวอย่างที่รองรับ: 15/05/2530 หรือ 1987-05-15)',
      });
    } else {
      resolved.birth_date = parsed.isoCe;
      if (parsed.convertedCeToBe) {
        setVal('birth_date', {
          status: 'WARNING',
          code: 'AUTO_FIXED_DATE_CE_TO_BE',
          message: `ตรวจพบปี ค.ศ. และแปลงเป็น พ.ศ. (${parsed.displayBe}) อัตโนมัติ`,
          normalizedValue: parsed.displayBe,
        });
      } else {
        setVal('birth_date', { status: 'VALID', normalizedValue: parsed.displayBe });
      }
    }
  }

  // 6. Phone Number
  const phoneRaw = cells.phone_number.trim().replace(/^'+/, '');
  if (!phoneRaw) {
    resolved.phone_number = null;
    setVal('phone_number', { status: 'VALID' });
  } else {
    const { value: arabicPhone } = toArabicDigits(phoneRaw);
    const digits = arabicPhone.replace(/[\s()-]/g, '');
    if (/^[6892]\d{8}$/.test(digits)) {
      const fixed = `0${digits}`;
      resolved.phone_number = fixed;
      setVal('phone_number', {
        status: 'WARNING',
        code: 'AUTO_FIXED_PHONE_ZERO',
        message: `เติมเลข 0 นำหน้าเบอร์โทรศัพท์อัตโนมัติ (${fixed})`,
        normalizedValue: fixed,
      });
    } else if (/^0\d{8,9}$/.test(digits)) {
      resolved.phone_number = digits;
      setVal('phone_number', { status: 'VALID', normalizedValue: digits });
    } else {
      resolved.phone_number = null;
      setVal('phone_number', {
        status: 'ERROR',
        code: 'INVALID_PHONE',
        message: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ต้องเป็นตัวเลข 9–10 หลัก เช่น 0812345678)',
      });
    }
  }

  // 7. Email
  const emailRaw = cells.email.trim();
  if (!emailRaw) {
    resolved.email = null;
    setVal('email', { status: 'VALID' });
  } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    resolved.email = emailRaw.toLowerCase();
    setVal('email', { status: 'VALID' });
  } else {
    resolved.email = null;
    setVal('email', {
      status: 'ERROR',
      code: 'INVALID_EMAIL',
      message: 'รูปแบบอีเมลไม่ถูกต้อง',
    });
  }

  // 8. Position 3-Level Cascade (PositionType -> Position -> PositionLevel)
  const posTypeRaw = cells.position_type_id.trim();
  const posRaw = cells.position_id.trim();
  const posLevelRaw = cells.position_level_id.trim();

  let matchedPosType = posTypeRaw ? index.matchPositionType(posTypeRaw) : null;
  if (posTypeRaw) {
    if (matchedPosType) {
      resolved.position_type_id = matchedPosType.id;
      setVal('position_type_id', { status: 'VALID', resolvedId: matchedPosType.id });
    } else {
      resolved.position_type_id = null;
      setVal('position_type_id', {
        status: 'ERROR',
        code: 'LOOKUP_NOT_FOUND',
        message: `ไม่พบประเภทตำแหน่ง "${posTypeRaw}"`,
        suggestions: index.suggestPositionType(posTypeRaw),
      });
    }
  } else {
    resolved.position_type_id = null;
    setVal('position_type_id', { status: 'VALID' });
  }

  let matchedPosition = null;
  if (posRaw) {
    if (matchedPosType) {
      matchedPosition = index.matchPositionInType(matchedPosType.id, posRaw);
      if (matchedPosition) {
        resolved.position_id = matchedPosition.id;
        setVal('position_id', { status: 'VALID', resolvedId: matchedPosition.id });
      } else {
        const globalHits = index.findPositionsByNameGlobal(posRaw);
        resolved.position_id = null;
        if (globalHits.length > 0) {
          const parentNames = globalHits
            .map((p) => index.getPositionTypeById(p.position_type_id)?.name_th)
            .filter(Boolean) as string[];
          setVal('position_id', {
            status: 'ERROR',
            code: 'POSITION_MISMATCH_TYPE',
            message: `ตำแหน่ง "${posRaw}" ไม่ได้อยู่ในประเภทตำแหน่ง "${matchedPosType.name_th}" (พบใน: ${parentNames.join(', ')})`,
            suggestions: index.suggestPosition(matchedPosType.id, posRaw),
            autoFillParentName: parentNames.length === 1 ? parentNames[0] : undefined,
          });
        } else {
          setVal('position_id', {
            status: 'ERROR',
            code: 'LOOKUP_NOT_FOUND',
            message: `ไม่พบตำแหน่ง "${posRaw}" ในประเภท "${matchedPosType.name_th}"`,
            suggestions: index.suggestPosition(matchedPosType.id, posRaw),
          });
        }
      }
    } else {
      const globalHits = index.findPositionsByNameGlobal(posRaw);
      if (globalHits.length === 1) {
        const parentType = index.getPositionTypeById(globalHits[0].position_type_id);
        resolved.position_id = null;
        setVal('position_id', {
          status: 'ERROR',
          code: 'PARENT_REQUIRED',
          message: `กรุณาระบุประเภทตำแหน่งก่อน (ตำแหน่งนี้อยู่ใน "${parentType?.name_th || '-'}")`,
          autoFillParentName: parentType?.name_th,
        });
      } else if (globalHits.length > 1) {
        resolved.position_id = null;
        setVal('position_id', {
          status: 'ERROR',
          code: 'PARENT_REQUIRED',
          message: `ตำแหน่ง "${posRaw}" มีอยู่ในหลายประเภทตำแหน่ง กรุณาระบุคอลัมน์ประเภทตำแหน่งให้ชัดเจน`,
        });
      } else {
        resolved.position_id = null;
        setVal('position_id', {
          status: 'ERROR',
          code: 'LOOKUP_NOT_FOUND',
          message: `ไม่พบตำแหน่ง "${posRaw}" ในฐานข้อมูล`,
          suggestions: index.suggestPosition(null, posRaw),
        });
      }
    }
  } else {
    resolved.position_id = null;
    setVal('position_id', { status: 'VALID' });
  }

  // Position Level validation with requires_level enforcement
  if (matchedPosition) {
    if (matchedPosition.requires_level) {
      if (!posLevelRaw) {
        resolved.position_level_id = null;
        setVal('position_level_id', {
          status: 'ERROR',
          code: 'LEVEL_REQUIRED',
          message: `ตำแหน่ง "${matchedPosition.name_th}" จำเป็นต้องระบุระดับตำแหน่ง`,
          suggestions: index.getAllowedLevelOptions(matchedPosition.id).slice(0, 3),
        });
      } else {
        const matchedLv = index.matchPositionLevel(posLevelRaw);
        if (!matchedLv) {
          resolved.position_level_id = null;
          setVal('position_level_id', {
            status: 'ERROR',
            code: 'LOOKUP_NOT_FOUND',
            message: `ไม่พบระดับตำแหน่ง "${posLevelRaw}"`,
            suggestions: index.suggestPositionLevel(matchedPosition.id, posLevelRaw),
          });
        } else if (!index.isLevelAllowedForPosition(matchedPosition.id, matchedLv.id)) {
          resolved.position_level_id = null;
          setVal('position_level_id', {
            status: 'ERROR',
            code: 'LEVEL_NOT_ALLOWED_FOR_POSITION',
            message: `ระดับ "${matchedLv.name_th}" ไม่อนุญาตสำหรับตำแหน่ง "${matchedPosition.name_th}"`,
            suggestions: index.getAllowedLevelOptions(matchedPosition.id).slice(0, 3),
          });
        } else {
          resolved.position_level_id = matchedLv.id;
          setVal('position_level_id', { status: 'VALID', resolvedId: matchedLv.id });
        }
      }
    } else if (posLevelRaw) {
      resolved.position_level_id = null;
      setVal('position_level_id', {
        status: 'ERROR',
        code: 'LEVEL_NOT_ALLOWED_WHEN_NOT_REQUIRED',
        message: `ตำแหน่ง "${matchedPosition.name_th}" ไม่มีระดับตำแหน่ง กรุณาลบค่าในช่องนี้ให้ว่าง`,
      });
    } else {
      resolved.position_level_id = null;
      setVal('position_level_id', { status: 'VALID' });
    }
  } else if (posLevelRaw) {
    const matchedLv = index.matchPositionLevel(posLevelRaw);
    resolved.position_level_id = matchedLv?.id ?? null;
    if (!matchedLv) {
      setVal('position_level_id', {
        status: 'ERROR',
        code: 'LOOKUP_NOT_FOUND',
        message: `ไม่พบระดับตำแหน่ง "${posLevelRaw}"`,
        suggestions: index.suggestPositionLevel(null, posLevelRaw),
      });
    } else {
      setVal('position_level_id', { status: 'VALID', resolvedId: matchedLv.id });
    }
  } else {
    resolved.position_level_id = null;
    setVal('position_level_id', { status: 'VALID' });
  }

  // 9. Org 4-Level Composite Key Cascade (Bureau -> Office -> Department -> Division)
  const bureauRaw = cells.bureau_id.trim();
  const officeRaw = cells.office_id.trim();
  const deptRaw = cells.department_id.trim();
  const divRaw = cells.division_id.trim();

  let matchedBureau = bureauRaw ? index.matchBureau(bureauRaw) : null;
  if (bureauRaw) {
    if (matchedBureau) {
      resolved.bureau_id = matchedBureau.id;
      setVal('bureau_id', { status: 'VALID', resolvedId: matchedBureau.id });
    } else {
      resolved.bureau_id = null;
      setVal('bureau_id', {
        status: 'ERROR',
        code: 'LOOKUP_NOT_FOUND',
        message: `ไม่พบสำนัก "${bureauRaw}"`,
        suggestions: index.suggestBureau(bureauRaw),
      });
    }
  } else if (index.singleActiveBureau) {
    matchedBureau = index.singleActiveBureau;
    resolved.bureau_id = matchedBureau.id;
    setVal('bureau_id', {
      status: 'WARNING',
      code: 'AUTO_FIXED_SINGLE_BUREAU',
      message: `เติมสำนักเริ่มต้น "${matchedBureau.name_th}" อัตโนมัติ`,
      resolvedId: matchedBureau.id,
      normalizedValue: matchedBureau.name_th,
    });
  } else {
    resolved.bureau_id = null;
    setVal('bureau_id', { status: 'VALID' });
  }

  // Level 2: Office
  let matchedOffice = null;
  if (officeRaw) {
    if (matchedBureau) {
      matchedOffice = index.matchOfficeInBureau(matchedBureau.id, officeRaw);
      if (matchedOffice) {
        resolved.office_id = matchedOffice.id;
        setVal('office_id', { status: 'VALID', resolvedId: matchedOffice.id });
      } else {
        const globalOffices = index.findOfficesByNameGlobal(officeRaw);
        resolved.office_id = null;
        if (globalOffices.length > 0) {
          const parentNames = globalOffices
            .map((o) => (o.parent_id ? index.getOrgById(o.parent_id)?.name_th : null))
            .filter(Boolean) as string[];
          setVal('office_id', {
            status: 'ERROR',
            code: 'ORG_PARENT_MISMATCH',
            message: `สำนักงาน/กอง "${officeRaw}" ไม่ได้สังกัด "${matchedBureau.name_th}"`,
            suggestions: index.suggestOffice(matchedBureau.id, officeRaw),
            autoFillParentName: parentNames.length === 1 ? parentNames[0] : undefined,
          });
        } else {
          setVal('office_id', {
            status: 'ERROR',
            code: 'LOOKUP_NOT_FOUND',
            message: `ไม่พบสำนักงาน/กอง "${officeRaw}" ใน "${matchedBureau.name_th}"`,
            suggestions: index.suggestOffice(matchedBureau.id, officeRaw),
          });
        }
      }
    } else {
      const globalOffices = index.findOfficesByNameGlobal(officeRaw);
      resolved.office_id = null;
      const uniqueParent =
        globalOffices.length === 1 && globalOffices[0].parent_id
          ? index.getOrgById(globalOffices[0].parent_id)?.name_th
          : undefined;
      setVal('office_id', {
        status: 'ERROR',
        code: 'PARENT_REQUIRED',
        message: 'กรุณาระบุสำนัก (Lv1) ก่อนระบุสำนักงาน/กอง',
        autoFillParentName: uniqueParent,
      });
    }
  } else {
    resolved.office_id = null;
    setVal('office_id', { status: 'VALID' });
  }

  // Level 3: Department (Composite Key: office_id::normalized_name)
  let matchedDept = null;
  if (deptRaw) {
    if (matchedOffice) {
      matchedDept = index.matchDepartmentInOffice(matchedOffice.id, deptRaw);
      if (matchedDept) {
        resolved.department_id = matchedDept.id;
        setVal('department_id', { status: 'VALID', resolvedId: matchedDept.id });
      } else {
        const globalDepts = index.findDepartmentsByNameGlobal(deptRaw);
        resolved.department_id = null;
        if (globalDepts.length > 0) {
          const parentNames = globalDepts
            .map((d) => (d.parent_id ? index.getOrgById(d.parent_id)?.name_th : null))
            .filter(Boolean) as string[];
          setVal('department_id', {
            status: 'ERROR',
            code: 'ORG_PARENT_MISMATCH',
            message: `ส่วน/ฝ่าย "${deptRaw}" ไม่ได้สังกัด "${matchedOffice.name_th}" (พบใน: ${parentNames.slice(0, 3).join(', ')})`,
            suggestions: index.suggestDepartment(matchedOffice.id, deptRaw),
            autoFillParentName: parentNames.length === 1 ? parentNames[0] : undefined,
          });
        } else {
          setVal('department_id', {
            status: 'ERROR',
            code: 'LOOKUP_NOT_FOUND',
            message: `ไม่พบส่วน/ฝ่าย "${deptRaw}" ภายใต้ "${matchedOffice.name_th}"`,
            suggestions: index.suggestDepartment(matchedOffice.id, deptRaw),
          });
        }
      }
    } else {
      const globalDepts = index.findDepartmentsByNameGlobal(deptRaw);
      resolved.department_id = null;
      const uniqueParent =
        globalDepts.length === 1 && globalDepts[0].parent_id
          ? index.getOrgById(globalDepts[0].parent_id)?.name_th
          : undefined;
      setVal('department_id', {
        status: 'ERROR',
        code: 'PARENT_REQUIRED',
        message: uniqueParent
          ? `กรุณาระบุสำนักงาน/กอง (Lv2) ก่อน (พบส่วน/ฝ่ายนี้อยู่ภายใต้ "${uniqueParent}")`
          : `กรุณาระบุสำนักงาน/กอง (Lv2) ให้ชัดเจน เนื่องจากชื่อส่วน/ฝ่าย "${deptRaw}" อาจซ้ำกันได้ในหลายกอง`,
        autoFillParentName: uniqueParent,
      });
    }
  } else {
    resolved.department_id = null;
    setVal('department_id', { status: 'VALID' });
  }

  // Level 4: Division (Composite Key: department_id::normalized_name)
  if (divRaw) {
    if (matchedDept) {
      const matchedDiv = index.matchDivisionInDepartment(matchedDept.id, divRaw);
      if (matchedDiv) {
        resolved.division_id = matchedDiv.id;
        setVal('division_id', { status: 'VALID', resolvedId: matchedDiv.id });
      } else {
        const globalDivs = index.findDivisionsByNameGlobal(divRaw);
        resolved.division_id = null;
        if (globalDivs.length > 0) {
          const parentNames = globalDivs
            .map((dv) => (dv.parent_id ? index.getOrgById(dv.parent_id)?.name_th : null))
            .filter(Boolean) as string[];
          setVal('division_id', {
            status: 'ERROR',
            code: 'ORG_PARENT_MISMATCH',
            message: `กลุ่มงาน "${divRaw}" ไม่ได้สังกัด "${matchedDept.name_th}"`,
            suggestions: index.suggestDivision(matchedDept.id, divRaw),
            autoFillParentName: parentNames.length === 1 ? parentNames[0] : undefined,
          });
        } else {
          setVal('division_id', {
            status: 'ERROR',
            code: 'LOOKUP_NOT_FOUND',
            message: `ไม่พบกลุ่มงาน "${divRaw}" ภายใต้ "${matchedDept.name_th}"`,
            suggestions: index.suggestDivision(matchedDept.id, divRaw),
          });
        }
      }
    } else {
      const globalDivs = index.findDivisionsByNameGlobal(divRaw);
      resolved.division_id = null;
      const uniqueParent =
        globalDivs.length === 1 && globalDivs[0].parent_id
          ? index.getOrgById(globalDivs[0].parent_id)?.name_th
          : undefined;
      setVal('division_id', {
        status: 'ERROR',
        code: 'PARENT_REQUIRED',
        message: 'กรุณาระบุส่วน/ฝ่าย (Lv3) ก่อนระบุกลุ่มงาน',
        autoFillParentName: uniqueParent,
      });
    }
  } else {
    resolved.division_id = null;
    setVal('division_id', { status: 'VALID' });
  }

  // Admin Scope Enforcement (Lv2 Office Admin / Lv3 Department Admin)
  if (!isSuperAdmin && adminScope) {
    if (adminScope.scope_level_no === 2) {
      if (!resolved.office_id || resolved.office_id !== adminScope.org_unit_id) {
        setVal('office_id', {
          status: 'ERROR',
          code: 'OUT_OF_ADMIN_SCOPE',
          message: `สิทธิ์ของคุณจำกัดเฉพาะสำนักงาน/กอง "${adminScope.org_unit_name}" เท่านั้น`,
          suggestions: [adminScope.org_unit_name],
        });
      }
    } else if (adminScope.scope_level_no === 3) {
      if (!resolved.department_id || resolved.department_id !== adminScope.org_unit_id) {
        setVal('department_id', {
          status: 'ERROR',
          code: 'OUT_OF_ADMIN_SCOPE',
          message: `สิทธิ์ของคุณจำกัดเฉพาะส่วน/ฝ่าย "${adminScope.org_unit_name}" เท่านั้น`,
          suggestions: [adminScope.org_unit_name],
        });
      }
    }
  }

  // 10. Start Service Date & Year BE (fleet columns removed — managed in Fleet sub-app)
  const startRaw = cells.start_service_date.trim();
  let autoYearBe: number | null = null;
  if (!startRaw) {
    resolved.start_service_date = null;
    setVal('start_service_date', { status: 'VALID' });
  } else {
    const parsed = parseThaiOrIsoDate(startRaw);
    if (!parsed) {
      resolved.start_service_date = null;
      setVal('start_service_date', {
        status: 'ERROR',
        code: 'INVALID_DATE',
        message: 'รูปแบบวันบรรจุไม่ถูกต้อง (ตัวอย่าง: 01/10/2558)',
      });
    } else {
      resolved.start_service_date = parsed.isoCe;
      autoYearBe = parsed.yearBe;
      if (parsed.convertedCeToBe) {
        setVal('start_service_date', {
          status: 'WARNING',
          code: 'AUTO_FIXED_DATE_CE_TO_BE',
          message: `แปลงวันบรรจุจาก ค.ศ. เป็น พ.ศ. (${parsed.displayBe}) อัตโนมัติ`,
          normalizedValue: parsed.displayBe,
        });
      } else {
        setVal('start_service_date', { status: 'VALID', normalizedValue: parsed.displayBe });
      }
    }
  }

  const yearRaw = cells.start_service_year_be.trim();
  if (autoYearBe) {
    resolved.start_service_year_be = autoYearBe;
    const { value: arabicYear } = toArabicDigits(yearRaw);
    if (!yearRaw || Number(arabicYear) !== autoYearBe) {
      setVal('start_service_year_be', {
        status: 'WARNING',
        code: 'AUTO_FIXED_SERVICE_YEAR',
        message: `คำนวณปี พ.ศ. บรรจุ (${autoYearBe}) จากวันบรรจุอัตโนมัติ`,
        normalizedValue: String(autoYearBe),
      });
    } else {
      setVal('start_service_year_be', { status: 'VALID', normalizedValue: String(autoYearBe) });
    }
  } else if (!yearRaw) {
    resolved.start_service_year_be = null;
    setVal('start_service_year_be', { status: 'VALID' });
  } else {
    const { value: arabicYear } = toArabicDigits(yearRaw);
    const numYear = Number(arabicYear);
    if (!Number.isInteger(numYear) || numYear < 2450 || numYear > 2700) {
      resolved.start_service_year_be = null;
      setVal('start_service_year_be', {
        status: 'ERROR',
        code: 'INVALID_YEAR_BE',
        message: 'ปี พ.ศ. บรรจุต้องอยู่ระหว่าง 2450–2700',
      });
    } else {
      resolved.start_service_year_be = numYear;
      setVal('start_service_year_be', { status: 'VALID' });
    }
  }

  // 12. Salary numbers
  for (const nKey of ['initial_salary', 'current_salary'] as const) {
    const raw = cells[nKey].trim();
    if (!raw) {
      resolved[nKey] = null;
      setVal(nKey, { status: 'VALID' });
    } else {
      const parsed = parseSalaryNumber(raw);
      if (!parsed) {
        resolved[nKey] = null;
        setVal(nKey, {
          status: 'ERROR',
          code: 'INVALID_NUMBER',
          message: 'กรุณาระบุตัวเลขจำนวนเงินที่ถูกต้อง (ไม่ติดลบ)',
        });
      } else {
        resolved[nKey] = parsed.value;
        setVal(nKey, { status: 'VALID' });
      }
    }
  }

  // Aggregate counts and status
  let errorCount = 0;
  let warningCount = 0;
  for (const v of Object.values(validations)) {
    if (v?.status === 'ERROR') errorCount += 1;
    else if (v?.status === 'WARNING') warningCount += 1;
  }

  let rowStatus: RowImportStatus = 'NEW';
  if (errorCount > 0) {
    rowStatus = 'ERROR';
  } else if (existingSnapshot) {
    rowStatus = 'UPDATE';
  } else if (warningCount > 0) {
    rowStatus = 'WARNING';
  } else {
    rowStatus = 'NEW';
  }

  return {
    ...row,
    cells,
    resolved,
    validations,
    rowStatus,
    errorCount,
    warningCount,
    existingSnapshot,
  };
}
