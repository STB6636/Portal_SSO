import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { auditService } from '@/services/auditService';
import { QUERY_KEYS } from '@/lib/queryClient';
import { formatThaiDateTime } from '@/lib/thaiDate';

export default function AuditLogPage() {
  const [tab, setTab] = useState<'audit' | 'imports'>('audit');

  const { data: logs = [] } = useQuery({
    queryKey: QUERY_KEYS.auditLogs({ tab: 'audit' }),
    queryFn: () => auditService.listAuditLogs(),
  });

  const { data: jobs = [] } = useQuery({
    queryKey: QUERY_KEYS.auditLogs({ tab: 'imports' }),
    queryFn: () => auditService.listImportJobs(),
  });

  return (
    <AdminLayout
      title="ประวัติการใช้งาน (Audit Log)"
      subtitle="บันทึกการเปลี่ยนแปลงข้อมูลสำคัญและประวัติการนำเข้า CSV/Excel (กรองตามขอบเขตสังกัด)"
      activePage="settings-audit"
    >
      <div className="bma-card p-5 space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${tab === 'audit' ? 'bg-[#00744B] text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
          >
            บันทึกความปลอดภัย ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('imports')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${tab === 'imports' ? 'bg-[#00744B] text-white' : 'bg-slate-100 dark:bg-slate-800'}`}
          >
            ประวัตินำเข้าบุคลากร ({jobs.length})
          </button>
        </div>

        {tab === 'audit' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                  <th className="p-2.5">เวลา</th>
                  <th className="p-2.5">การกระทำ</th>
                  <th className="p-2.5">ตาราง / โดเมน</th>
                  <th className="p-2.5">CID (พราง PDPA)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((row) => (
                  <tr key={row.id}>
                    <td className="p-2.5 font-mono whitespace-nowrap">{formatThaiDateTime(row.created_at) || '-'}</td>
                    <td className="p-2.5 font-bold">{row.action}</td>
                    <td className="p-2.5 font-mono">{row.entity_type}</td>
                    <td className="p-2.5 font-mono">{row.cid_masked || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                  <th className="p-2.5">วันเวลานำเข้า</th>
                  <th className="p-2.5">ไฟล์ / แหล่งที่มา</th>
                  <th className="p-2.5">โหมด</th>
                  <th className="p-2.5">เพิ่มใหม่ / อัปเดต / ผิดพลาด</th>
                  <th className="p-2.5">สร้างบัญชี</th>
                  <th className="p-2.5">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="p-2.5 font-mono whitespace-nowrap">{formatThaiDateTime(j.created_at) || '-'}</td>
                    <td className="p-2.5 font-bold">{j.file_name} ({j.source_format})</td>
                    <td className="p-2.5 font-mono">{j.mode}</td>
                    <td className="p-2.5">
                      <span className="text-emerald-600 font-bold">+{j.inserted}</span> /{' '}
                      <span className="text-sky-600 font-bold">~{j.updated}</span> /{' '}
                      <span className="text-rose-600 font-bold">!{j.failed}</span>
                    </td>
                    <td className="p-2.5 font-bold">{j.accounts_created}</td>
                    <td className="p-2.5 font-mono">{j.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
