import { useState } from 'react';
import { verifyGoogleDriveFolder } from '@/services/driveStorageService';
import { useUiStore } from '@/stores/useUiStore';

type VerifyState = {
  checking: boolean;
  ok: boolean | null;
  message: string;
  verifiedValue?: string;
};

export interface SettingsGoogleDriveTabProps {
  form: Record<string, string>;
  setVal: (key: string, value: string) => void;
  saving: boolean;
  onSave: () => void;
}

const FOLDER_FIELDS = [
  {
    key: 'google_drive_image_folder_id',
    label: '1. โฟลเดอร์ไฟล์รูปภาพ',
    desc: 'สำหรับเก็บรูปโปรไฟล์ รูปประกาศระบบ และไอคอนเว็บแอปย่อย',
    icon: 'fa-image text-emerald-600',
  },
  {
    key: 'google_drive_signature_folder_id',
    label: '2. โฟลเดอร์ไฟล์ลายเซ็น',
    desc: 'สำหรับเก็บไฟล์รูปลายเซ็นอิเล็กทรอนิกส์พื้นใสสำหรับเอกสารราชการ',
    icon: 'fa-signature text-sky-600',
  },
  {
    key: 'google_drive_document_folder_id',
    label: '3. โฟลเดอร์ไฟล์เอกสาร',
    desc: 'สำหรับเก็บไฟล์เอกสารแนบ PDF, Word และ Excel',
    icon: 'fa-file-pdf text-rose-600',
  },
  {
    key: 'google_drive_logo_folder_id',
    label: '4. โฟลเดอร์รูปโลโก้ระบบ',
    desc: 'สำหรับเก็บไฟล์โลโก้หน่วยงานและตราสัญลักษณ์ระบบ (PNG, JPG, WebP)',
    icon: 'fa-shield-halved text-amber-600',
  },
] as const;

export function SettingsGoogleDriveTab({
  form,
  setVal,
  saving,
  onSave,
}: SettingsGoogleDriveTabProps) {
  const showToast = useUiStore((s) => s.showToast);
  const [verifyMap, setVerifyMap] = useState<Record<string, VerifyState>>({});
  const [verifyingBeforeSave, setVerifyingBeforeSave] = useState(false);

  const runVerify = async (fieldKey: string, folderVal: string, strictFolder = true, silent = false) => {
    const trimmedVal = fieldKey === 'script' ? (form.google_drive_script_url || '').trim() : folderVal.trim();
    setVerifyMap((p) => ({
      ...p,
      [fieldKey]: { checking: true, ok: null, message: 'กำลังตรวจสอบการเชื่อมต่อ...' },
    }));
    const res = await verifyGoogleDriveFolder(
      form.google_drive_script_url || '',
      folderVal,
      strictFolder
    );
    setVerifyMap((p) => ({
      ...p,
      [fieldKey]: {
        checking: false,
        ok: res.success,
        message: res.success
          ? `เชื่อมต่อสำเร็จ${res.folderName ? ` — โฟลเดอร์: ${res.folderName}` : ''}${
              res.version ? ` · Bridge v${res.version}` : ''
            }${res.sharingAccess && res.sharingAccess !== 'UNKNOWN' ? ` · สิทธิ์: ${res.sharingAccess}` : ''}`
          : res.message || 'ตรวจสอบไม่สำเร็จ',
        verifiedValue: res.success ? trimmedVal : undefined,
      },
    }));
    if (!silent) {
      showToast(
        res.success ? 'เชื่อมต่อ Google Drive สำเร็จ' : res.message || 'ไม่สามารถเชื่อมต่อได้',
        res.success ? 'success' : 'error'
      );
    }
    return res;
  };

  const handleSaveWithGuard = async () => {
    const scriptUrl = (form.google_drive_script_url || '').trim();
    const nonEmptyFolders = FOLDER_FIELDS.filter((f) => Boolean((form[f.key] || '').trim()));

    if (nonEmptyFolders.length > 0 && !scriptUrl) {
      showToast('กรุณากรอกลิงก์ Google Apps Script Web App ก่อนบันทึกโฟลเดอร์ Google Drive', 'error');
      return;
    }

    if (!scriptUrl) {
      onSave();
      return;
    }

    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/i.test(scriptUrl)) {
      setVerifyMap((p) => ({
        ...p,
        script: {
          checking: false,
          ok: false,
          message: 'รูปแบบลิงก์ Web App ไม่ถูกต้อง ต้องลงท้ายด้วย /exec',
        },
      }));
      showToast('รูปแบบลิงก์ Google Apps Script ไม่ถูกต้อง (ต้องลงท้ายด้วย /exec)', 'error');
      return;
    }

    setVerifyingBeforeSave(true);
    try {
      const scriptState = verifyMap.script;
      if (!scriptState?.ok || scriptState.verifiedValue !== scriptUrl) {
        const scriptRes = await runVerify('script', '', false, true);
        if (!scriptRes.success) {
          showToast(`ไม่สามารถเชื่อมต่อ Google Apps Script ได้: ${scriptRes.message || 'กรุณาตรวจสอบลิงก์'}`, 'error');
          return;
        }
      }

      const failedLabels: string[] = [];
      for (const f of nonEmptyFolders) {
        const val = (form[f.key] || '').trim();
        const st = verifyMap[f.key];
        if (st?.ok && st.verifiedValue === val) continue;
        const res = await runVerify(f.key, val, true, true);
        if (!res.success) {
          failedLabels.push(f.label);
        }
      }

      if (failedLabels.length > 0) {
        showToast(
          `ไม่สามารถบันทึกได้ เนื่องจากตรวจสอบโฟลเดอร์ไม่ผ่าน: ${failedLabels.join(', ')}`,
          'error'
        );
        return;
      }

      onSave();
    } finally {
      setVerifyingBeforeSave(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bma-card p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
              <i className="fa-brands fa-google-drive text-base" />
            </span>
            <div>
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">
                เชื่อมต่อพื้นที่จัดเก็บไฟล์ Google Drive
              </h3>
              <p className="text-[11px] text-slate-500">
                แยกจัดเก็บ 4 โฟลเดอร์ผ่าน Google Apps Script Web App พร้อมตรวจสอบลิงก์อัตโนมัติก่อนบันทึก
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            จัดเก็บไฟล์บน Google Drive 100%
          </span>
        </div>

        {/* GAS Script URL */}
        <div className="space-y-1.5">
          <label className="bma-label">ลิงก์ Google Apps Script Web App (ลงท้ายด้วย /exec)</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={form.google_drive_script_url || ''}
              onChange={(e) => {
                setVal('google_drive_script_url', e.target.value);
                setVerifyMap({});
              }}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="bma-input font-mono text-xs flex-1"
            />
            <button
              type="button"
              onClick={() => void runVerify('script', '', false)}
              disabled={verifyMap.script?.checking}
              className="bma-btn-outline text-xs shrink-0"
            >
              <i className={`fa-solid ${verifyMap.script?.checking ? 'fa-spinner fa-spin' : 'fa-plug-circle-check'} text-emerald-600`} />
              ตรวจสอบการเชื่อมต่อ
            </button>
          </div>
          {verifyMap.script?.message && (
            <p
              className={`text-xs font-semibold ${
                verifyMap.script.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              <i className={`fa-solid ${verifyMap.script.ok ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1`} />
              {verifyMap.script.message}
            </p>
          )}
        </div>

        {/* 4 Separate Drive Folders */}
        <div className="space-y-3">
          {FOLDER_FIELDS.map((f) => {
            const st = verifyMap[f.key];
            const val = (form[f.key] || '').trim();
            const configured = Boolean(val);
            const verifiedCurrent = Boolean(st?.ok && st.verifiedValue === val);
            return (
              <div
                key={f.key}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                      <i className={`fa-solid ${f.icon} mr-1.5`} />
                      {f.label}
                    </div>
                    <p className="text-[11px] text-slate-500">{f.desc}</p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      verifiedCurrent
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                        : st?.ok === false
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300'
                          : configured
                            ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {verifiedCurrent
                      ? 'ตรวจสอบผ่านแล้ว'
                      : st?.ok === false
                        ? 'ลิงก์ไม่ถูกต้อง / เข้าถึงไม่ได้'
                        : configured
                          ? 'กรอกค่าแล้ว (จะตรวจสอบก่อนบันทึก)'
                          : 'ยังไม่ตั้งค่า'}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={form[f.key] || ''}
                    onChange={(e) => {
                      setVal(f.key, e.target.value);
                      setVerifyMap((p) => {
                        const next = { ...p };
                        delete next[f.key];
                        return next;
                      });
                    }}
                    placeholder="วางรหัสโฟลเดอร์ หรือลิงก์โฟลเดอร์ Google Drive"
                    className="bma-input font-mono text-xs flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => void runVerify(f.key, form[f.key] || '', true)}
                    disabled={st?.checking}
                    className="bma-btn-primary text-xs shrink-0"
                  >
                    <i className={`fa-solid ${st?.checking ? 'fa-spinner fa-spin' : 'fa-check-double'}`} />
                    ตรวจสอบโฟลเดอร์
                  </button>
                </div>

                {st?.message && (
                  <p
                    className={`text-xs font-semibold ${
                      st.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {st.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving || verifyingBeforeSave}
          onClick={() => void handleSaveWithGuard()}
          className="bma-btn-primary px-6 py-2.5 disabled:opacity-60"
        >
          <i className={`fa-solid ${saving || verifyingBeforeSave ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
          {verifyingBeforeSave ? 'กำลังตรวจสอบลิงก์ก่อนบันทึก...' : 'ตรวจสอบและบันทึกการตั้งค่า Google Drive'}
        </button>
      </div>
    </div>
  );
}
