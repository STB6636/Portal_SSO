import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { maskCid } from '@/lib/cidValidator';
import type { StagingRow } from '@/types/import.types';

interface UpsertDiffModalProps {
  open: boolean;
  onClose: () => void;
  updateRows: StagingRow[];
  onConfirmProceed: () => void;
}

export function UpsertDiffModal({
  open,
  onClose,
  updateRows,
  onConfirmProceed,
}: UpsertDiffModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="ตรวจสอบความแตกต่างก่อนอัปเดตข้อมูลเดิม (UPSERT Diff Preview)"
      subtitle={`พบบุคลากรที่มีเลขบัตรประชาชนอยู่ในฐานข้อมูลแล้ว ${updateRows.length} รายการ`}
      icon="fa-code-compare"
      maxWidthClass="max-w-4xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="bma-btn-outline">
            กลับไปแก้ไขในตาราง
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirmProceed();
            }}
            className="bma-btn-primary"
          >
            <i className="fa-solid fa-cloud-arrow-up mr-1.5" />
            ยืนยันอัปเดตและนำเข้าทั้งหมด
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {updateRows.slice(0, 50).map((row) => {
          const old = row.existingSnapshot;
          if (!old) return null;
          const diffs: Array<{ label: string; before: string; after: string }> = [];
          const checkDiff = (label: string, beforeVal: string | number | null | undefined, afterVal: string) => {
            const b = String(beforeVal ?? '').trim();
            const a = String(afterVal ?? '').trim();
            if (a && a !== b) {
              diffs.push({ label, before: b || '(ว่าง)', after: a });
            }
          };
          checkDiff('ชื่อ', old.first_name, row.cells.first_name);
          checkDiff('นามสกุล', old.last_name, row.cells.last_name);
          checkDiff('เบอร์โทร', old.phone_number, String(row.resolved.phone_number || row.cells.phone_number));
          checkDiff('อีเมล', old.email, row.cells.email);
          checkDiff('ตำแหน่ง', old.position_name, row.cells.position_id);
          checkDiff('ระดับ', old.position_level_name, row.cells.position_level_id);
          checkDiff('สำนักงาน/กอง', old.office_name, row.cells.office_id);
          checkDiff('ส่วน/ฝ่าย', old.department_name, row.cells.department_id);
          checkDiff('เงินเดือนปัจจุบัน', old.current_salary, row.cells.current_salary);

          return (
            <div
              key={row.rowId}
              className="rounded-xl border border-blue-200 dark:border-blue-800/70 bg-blue-50/40 dark:bg-blue-950/20 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  แถว {row.sheetRowNo}: {old.full_name}
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {maskCid(old.cid)}
                </span>
              </div>
              {diffs.length === 0 ? (
                <p className="text-xs text-slate-500 italic">ไม่มีการเปลี่ยนแปลงในฟิลด์หลัก</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {diffs.map((d) => (
                    <div
                      key={d.label}
                      className="rounded-lg bg-white dark:bg-slate-900 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700"
                    >
                      <span className="font-semibold text-slate-600 dark:text-slate-300">{d.label}: </span>
                      <span className="line-through text-rose-500 mr-1.5">{d.before}</span>
                      <i className="fa-solid fa-arrow-right text-[10px] text-slate-400 mr-1.5" />
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">{d.after}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {updateRows.length > 50 && (
          <p className="text-xs text-center text-slate-500">
            แสดงตัวอย่าง 50 รายการแรกจากทั้งหมด {updateRows.length} รายการที่จะอัปเดต
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
}
