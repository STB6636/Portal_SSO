// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { ThaiDatePicker } from '@/components/common/ThaiDatePicker';
import {
  applyPositionHistorySaveWithTags,
  autoCloseOpenEndedPositionRows,
  buildFirstPositionHistoryPrefill,
  buildFirstSalaryHistoryPrefill,
  computeHistoryFieldLocks,
  findOpenEndedPositionIndices,
  getExecutiveOnlyPositions,
  moveHistoryItem,
  normalizePositionHistoryTags,
  resolveDisciplinarySnapshot,
  resolveExecutiveDutiesSummaries,
  resolveInitialPositionSnapshot,
  resolveLatestPositionSnapshot,
  resolveLatestSalarySnapshot,
  subtractOneDayIso,
} from '@/lib/personnelHistorySync';
import type { MasterDataBundle } from '@/types/domain.types';
import type { PersonnelPositionHistoryRow } from '@/types/database.types';

function makeMaster(): MasterDataBundle {
  const now = '2026-01-01T00:00:00Z';
  return {
    categories: [],
    items: [],
    itemsByCategoryCode: {
      DISCIPLINARY_TYPE: [
        { id: 'dt-1', category_id: 'c-dt', code: 'INVESTIGATION_MINOR', name_th: 'สอบสวนวินัยไม่ร้ายแรง', short_name: null, color_hex: null, rank_order: 1, is_default: false, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      ],
      DISCIPLINARY_PENALTY: [
        { id: 'dp-1', category_id: 'c-dp', code: 'REPRIMAND', name_th: 'ภาคทัณฑ์', short_name: null, color_hex: null, rank_order: 10, is_default: false, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      ],
      DISCIPLINARY_CASE_STATUS: [
        { id: 'ds-ongoing', category_id: 'c-ds', code: 'ONGOING', name_th: 'อยู่ระหว่างดำเนินการ', short_name: null, color_hex: '#D97706', rank_order: 1, is_default: false, allows_account_provision: true, is_approver: false, sort_order: 1, is_active: true, created_at: now, updated_at: now },
        { id: 'ds-cleared', category_id: 'c-ds', code: 'CLOSED_CLEARED', name_th: 'ยุติ - พ้นมลทิน', short_name: null, color_hex: '#16A34A', rank_order: 3, is_default: false, allows_account_provision: true, is_approver: false, sort_order: 3, is_active: true, created_at: now, updated_at: now },
      ],
    },
    orgUnitLevels: [],
    orgUnits: [
      { id: 'b-1', level_id: 'l1', level_no: 1, parent_id: null, code: 'STB', name_th: 'สำนักเทศกิจ', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'o-1', level_id: 'l2', level_no: 2, parent_id: 'b-1', code: 'SEC', name_th: 'สำนักงานเลขานุการ', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'd-1', level_id: 'l3', level_no: 3, parent_id: 'o-1', code: null, name_th: 'ฝ่ายบริหารงานทั่วไป', short_name: null, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'o-2', level_id: 'l2', level_no: 2, parent_id: 'b-1', code: 'LAW', name_th: 'สำนักงานตรวจและบังคับการ', short_name: null, sort_order: 2, is_active: true, created_at: now, updated_at: now },
    ],
    positionTypes: [
      { id: 'pt-exec', code: 'EXECUTIVE', name_th: 'ประเภทบริหาร', color_hex: '#7C3AED', sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'pt-acad', code: 'ACADEMIC', name_th: 'ประเภทวิชาการ', color_hex: '#00744B', sort_order: 2, is_active: true, created_at: now, updated_at: now },
    ],
    positions: [
      { id: 'pos-dir', position_type_id: 'pt-exec', name_th: 'ผู้อำนวยการสำนัก', requires_level: true, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'pos-dep', position_type_id: 'pt-exec', name_th: 'รองผู้อำนวยการสำนัก', requires_level: true, sort_order: 2, is_active: true, created_at: now, updated_at: now },
      { id: 'pos-com', position_type_id: 'pt-acad', name_th: 'นักวิชาการคอมพิวเตอร์', requires_level: true, sort_order: 3, is_active: true, created_at: now, updated_at: now },
    ],
    positionLevels: [
      { id: 'lvl-e1', code: 'E1', name_th: 'บริหารต้น', rank_order: 90, sort_order: 1, is_active: true, created_at: now, updated_at: now },
      { id: 'lvl-e2', code: 'E2', name_th: 'บริหารสูง', rank_order: 100, sort_order: 2, is_active: true, created_at: now, updated_at: now },
      { id: 'lvl-k2', code: 'K2', name_th: 'ชำนาญการ', rank_order: 50, sort_order: 3, is_active: true, created_at: now, updated_at: now },
    ],
    positionAllowedLevels: [],
  };
}

describe('personnelHistorySync pure domain engine', () => {
  const master = makeMaster();

  it('supports Bypass Mode when histories are empty and locks fields as soon as rows exist', () => {
    const emptyLocks = computeHistoryFieldLocks({
      positionHistoryCount: 0,
      salaryHistoryCount: 0,
      disciplinaryRecordsCount: 0,
    });
    expect(emptyLocks.positionFieldsDisabled).toBe(false);
    expect(emptyLocks.salaryFieldsDisabled).toBe(false);
    expect(emptyLocks.disciplinaryFieldsDisabled).toBe(false);
    expect(emptyLocks.executiveDutiesManagedByList).toBe(true);

    const activeLocks = computeHistoryFieldLocks({
      positionHistoryCount: 1,
      salaryHistoryCount: 2,
      disciplinaryRecordsCount: 1,
    });
    expect(activeLocks.positionFieldsDisabled).toBe(true);
    expect(activeLocks.salaryFieldsDisabled).toBe(true);
    expect(activeLocks.disciplinaryFieldsDisabled).toBe(true);
  });

  it('resolves latest open-ended position, continuous dates, pre-fill, and auto-closes prior open row', () => {
    const prefill = buildFirstPositionHistoryPrefill({
      position_type_id: 'pt-acad',
      position_id: 'pos-com',
      position_level_id: 'lvl-k2',
      position_number: '1042',
      current_position_date: '2022-10-01',
      office_id: 'o-1',
      department_id: 'd-1',
      division_id: '',
    });
    expect(prefill.position_id).toBe('pos-com');
    expect(prefill.end_date).toBeNull();
    expect(prefill.org_unit_id).toBe('d-1');

    // Falls back to bureau_id when office/dept/division are empty (Lv1 executive)
    const bureauOnlyPrefill = buildFirstPositionHistoryPrefill({
      position_type_id: 'pt-exec',
      position_id: 'pos-dir',
      position_level_id: 'lvl-e2',
      position_number: '0001',
      current_position_date: '2024-10-01',
      bureau_id: 'b-1',
      office_id: '',
      department_id: '',
      division_id: '',
    });
    expect(bureauOnlyPrefill.org_unit_id).toBe('b-1');

    expect(subtractOneDayIso('2025-10-01')).toBe('2025-09-30');

    const rows = [
      {
        position_type_id: 'pt-acad',
        position_id: 'pos-com',
        position_level_id: 'lvl-k2',
        position_number: '1042',
        effective_date: '2022-10-01',
        end_date: null,
      },
    ];
    expect(findOpenEndedPositionIndices(rows)).toEqual([0]);

    const closed = autoCloseOpenEndedPositionRows(rows, '2025-10-01');
    expect(closed[0].end_date).toBe('2025-09-30');

    const withNew = [
      ...closed,
      {
        position_type_id: 'pt-acad',
        position_id: 'pos-com',
        position_level_id: 'lvl-k2',
        position_number: '2099',
        effective_date: '2025-10-01',
        end_date: null,
      },
    ];
    const snap = resolveLatestPositionSnapshot(withNew);
    expect(snap).not.toBeNull();
    expect(snap?.hasOpenEnded).toBe(true);
    expect(snap?.position_number).toBe('2099');
    // Continuous position & level dates roll back to 2022-10-01 because same position_id & position_level_id
    expect(snap?.current_position_date).toBe('2022-10-01');
    expect(snap?.current_level_date).toBe('2022-10-01');
  });

  it('filters executive-only positions and formats multi-duty deputizing + acting summaries', () => {
    const execPositions = getExecutiveOnlyPositions(master);
    expect(execPositions.map((p) => p.id)).toEqual(['pos-dir', 'pos-dep']);

    const { deputizingSummary, actingSummary, activeCount } = resolveExecutiveDutiesSummaries(
      [
        {
          duty_type: 'DEPUTIZING',
          position_type_id: 'pt-exec',
          position_id: 'pos-dir',
          position_level_id: 'lvl-e2',
          bureau_id: 'b-1',
          office_id: 'o-1',
          department_id: 'd-1',
          end_date: null,
        },
        {
          duty_type: 'DEPUTIZING',
          position_type_id: 'pt-exec',
          position_id: 'pos-dep',
          position_level_id: 'lvl-e1',
          bureau_id: 'b-1',
          office_id: 'o-2',
          end_date: null,
        },
        {
          duty_type: 'ACTING',
          position_type_id: 'pt-exec',
          position_id: 'pos-dir',
          position_level_id: 'lvl-e2',
          bureau_id: 'b-1',
          end_date: null,
        },
        // Ended duty should be excluded from active summary
        {
          duty_type: 'ACTING',
          position_type_id: 'pt-exec',
          position_id: 'pos-dep',
          position_level_id: 'lvl-e1',
          bureau_id: 'b-1',
          office_id: 'o-1',
          end_date: '2024-09-30',
        },
      ],
      master
    );
    expect(activeCount).toBe(3);
    expect(deputizingSummary).toContain('ผู้อำนวยการสำนักเทศกิจ');
    expect(deputizingSummary).toContain('รองผู้อำนวยการสำนักเทศกิจ');
    expect(deputizingSummary).not.toContain('ระดับบริหาร');
    expect(actingSummary).toBe('ผู้อำนวยการสำนักเทศกิจ');
  });

  it('syncs latest salary history and disciplinary true/false status cleanly', () => {
    const salPrefill = buildFirstSalaryHistoryPrefill({
      current_salary: '32500',
      position_allowance: '3500',
      is_max_step: true,
    });
    expect(salPrefill.base_salary).toBe(32500);
    expect(salPrefill.position_allowance).toBe(3500);

    const salSnap = resolveLatestSalarySnapshot([
      { base_salary: 28000, position_allowance: 0, is_max_step: false, effective_date: '2023-10-01' },
      { base_salary: 35000, position_allowance: 5600, is_max_step: true, effective_date: '2025-10-01' },
    ]);
    expect(salSnap?.current_salary).toBe('35000');
    expect(salSnap?.position_allowance).toBe('5600');
    expect(salSnap?.is_max_step).toBe(true);

    const ongoingDisc = resolveDisciplinarySnapshot(
      [{ record_type_id: 'dt-1', penalty_level_id: 'dp-1', case_status_id: 'ds-ongoing', effective_date: '2025-01-15', remark: 'รอกรรมการ' }],
      master
    );
    expect(ongoingDisc.disciplinary_flag).toBe(true);
    expect(ongoingDisc.disciplinary_note).toContain('สอบสวนวินัยไม่ร้ายแรง');

    const clearedDisc = resolveDisciplinarySnapshot(
      [{ record_type_id: 'dt-1', penalty_level_id: null, case_status_id: 'ds-cleared', effective_date: '2025-01-15', remark: 'พ้นข้อกล่าวหา' }],
      master
    );
    expect(clearedDisc.disciplinary_flag).toBe(false);
    expect(clearedDisc.disciplinary_note).toBe('');
  });

  it('enforces Checkpoint C5-A history ordering, single-row dual tags, and initial position sync', () => {
    const emptyLocks = computeHistoryFieldLocks({
      positionHistoryCount: 0,
      salaryHistoryCount: 0,
      disciplinaryRecordsCount: 0,
    });
    expect(emptyLocks.initialPositionFieldsDisabled).toBe(false);

    // Single row gets BOTH is_latest and is_initial
    const single = normalizePositionHistoryTags<Partial<PersonnelPositionHistoryRow>>([
      { position_type_id: 'pt-acad', position_id: 'pos-com', position_level_id: 'lvl-k2', effective_date: '2020-10-01' },
    ]);
    expect(single[0].is_latest).toBe(true);
    expect(single[0].is_initial).toBe(true);
    expect(single[0].sort_order).toBe(1);

    // Adding a row with makeLatest moves it to top; old row becomes initial at bottom
    const twoRows = applyPositionHistorySaveWithTags(
      single,
      null,
      { position_type_id: 'pt-exec', position_id: 'pos-dir', position_level_id: 'lvl-e2', effective_date: '2025-10-01', org_unit_id: 'b-1' },
      { makeLatest: true }
    );
    expect(twoRows).toHaveLength(2);
    expect(twoRows[0].position_id).toBe('pos-dir');
    expect(twoRows[0].is_latest).toBe(true);
    expect(twoRows[0].is_initial).toBe(false);
    expect(twoRows[1].position_id).toBe('pos-com');
    expect(twoRows[1].is_latest).toBe(false);
    expect(twoRows[1].is_initial).toBe(true);

    const initSnap = resolveInitialPositionSnapshot(twoRows, master);
    expect(initSnap?.initial_position_id).toBe('pos-com');
    expect(initSnap?.initial_position).toBe('นักวิชาการคอมพิวเตอร์ชำนาญการ');

    // Moving bottom row up swaps tags automatically
    const swapped = normalizePositionHistoryTags(moveHistoryItem(twoRows, 1, -1));
    expect(swapped[0].position_id).toBe('pos-com');
    expect(swapped[0].is_latest).toBe(true);
    expect(swapped[1].position_id).toBe('pos-dir');
    expect(swapped[1].is_initial).toBe(true);
  });
});

describe('ResponsiveModal nested stack & ThaiDatePicker z-[9998] layering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.classList.remove('bma-modal-open');
  });

  it('closes only the topmost nested modal on Escape, preserves bma-modal-open until all close, and renders ThaiDatePicker at z-[9998]', () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();

    act(() => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ResponsiveModal, {
            open: true,
            onClose: closeParent,
            title: 'Parent Modal',
            zIndexClass: 'z-[9990]',
            children: React.createElement('div', null, 'Parent Body'),
          }),
          React.createElement(ResponsiveModal, {
            open: true,
            onClose: closeChild,
            title: 'Child Overlay',
            zIndexClass: 'z-[9995]',
            children: React.createElement(ThaiDatePicker, { value: '2026-10-01', onChange: () => {} }),
          })
        )
      );
    });

    expect(document.body.classList.contains('bma-modal-open')).toBe(true);

    // Open ThaiDatePicker popover inside Child Overlay -> verify z-[9998]
    const calBtn = container.querySelector('button[aria-label="เปิดปฏิทิน พ.ศ."]') as HTMLButtonElement;
    act(() => {
      calBtn.click();
    });
    const popover = document.body.querySelector('div[role="dialog"][aria-label="ปฏิทินพุทธศักราช"]');
    expect(popover).not.toBeNull();
    expect(popover?.className).toContain('z-[9998]');

    // First Escape closes only the ThaiDatePicker popover
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closeChild).not.toHaveBeenCalled();
    expect(closeParent).not.toHaveBeenCalled();

    // Second Escape closes only the topmost Child Overlay
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closeChild).toHaveBeenCalledTimes(1);
    expect(closeParent).not.toHaveBeenCalled();

    // Unmount Child Overlay while Parent stays open -> bma-modal-open MUST remain on body
    act(() => {
      root.render(
        React.createElement(ResponsiveModal, {
          open: true,
          onClose: closeParent,
          title: 'Parent Modal',
          zIndexClass: 'z-[9990]',
          children: React.createElement('div', null, 'Parent Body'),
        })
      );
    });
    expect(document.body.classList.contains('bma-modal-open')).toBe(true);

    // Next Escape closes Parent Modal
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closeParent).toHaveBeenCalledTimes(1);
  });
});
