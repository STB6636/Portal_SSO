import { useQuery } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { MobileShortcutGrid } from '@/components/common/MobileShortcutGrid';
import { ScopeBadge } from '@/components/common/ScopeBadge';
import { personnelService } from '@/services/personnelService';
import { QUERY_KEYS } from '@/lib/queryClient';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

export default function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: QUERY_KEYS.dashboardStats,
    queryFn: () => personnelService.getDashboardStats(),
  });

  const barData = {
    labels: (stats?.personnel_by_office ?? []).map((x) => x.name),
    datasets: [
      {
        label: 'จำนวนบุคลากร',
        data: (stats?.personnel_by_office ?? []).map((x) => x.count),
        backgroundColor: '#00744B',
        borderRadius: 8,
      },
    ],
  };

  const doughnutData = {
    labels: (stats?.personnel_by_position_type ?? []).map((x) => x.name),
    datasets: [
      {
        data: (stats?.personnel_by_position_type ?? []).map((x) => x.count),
        backgroundColor: (stats?.personnel_by_position_type ?? []).map((x) => x.color || '#00744B'),
      },
    ],
  };

  return (
    <AdminLayout
      title="แดชบอร์ดภาพรวมระบบ"
      subtitle="สถิติบุคลากร บัญชีผู้ใช้งาน และเว็บแอปย่อยในขอบเขตสังกัดที่รับผิดชอบ"
      activePage="dashboard"
    >
      <div className="space-y-6">
        <MobileShortcutGrid />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
            <i className="fa-solid fa-shield-halved text-[#00744B] mr-1.5" />
            ขอบเขตข้อมูลที่กำลังแสดง (Scoped RLS):
          </p>
          <ScopeBadge />
        </div>

        {/* Jewel-Tone KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="stat-card stat-card-total">
            <div className="deco-1" />
            <div className="deco-2" />
            <div className="stat-content flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-emerald-100">บุคลากรทั้งหมดในขอบเขต</p>
                <p className="text-3xl font-black mt-1">{stats?.total_personnel ?? 0}</p>
                <p className="text-[11px] text-emerald-200 mt-0.5">ปฏิบัติราชการ {stats?.active_personnel ?? 0} คน</p>
              </div>
              <div className="stat-icon-box">
                <i className="fa-solid fa-users" />
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ background: 'linear-gradient(135deg, #075985 0%, #0284C7 100%)' }}>
            <div className="deco-1" />
            <div className="stat-content flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-sky-100">บัญชีผู้ใช้งาน SSO</p>
                <p className="text-3xl font-black mt-1">{stats?.total_users ?? 0}</p>
                <p className="text-[11px] text-sky-200 mt-0.5">คำขอรีเซ็ตรหัส {stats?.pending_reset_requests ?? 0} รายการ</p>
              </div>
              <div className="stat-icon-box">
                <i className="fa-solid fa-user-check" />
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ background: 'linear-gradient(135deg, #4C1D95 0%, #7C3AED 100%)' }}>
            <div className="deco-1" />
            <div className="stat-content flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-purple-100">เว็บแอปย่อยที่เปิดใช้</p>
                <p className="text-3xl font-black mt-1">{stats?.total_webapps ?? 0}</p>
                <p className="text-[11px] text-purple-200 mt-0.5">เชื่อมต่อผ่าน Central portal-api</p>
              </div>
              <div className="stat-icon-box">
                <i className="fa-solid fa-window-restore" />
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ background: 'linear-gradient(135deg, #9A3412 0%, #EA580C 100%)' }}>
            <div className="deco-1" />
            <div className="stat-content flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-orange-100">ผู้มีอำนาจลงนาม / ปฏิบัติราชการแทน-รักษาการ</p>
                <p className="text-3xl font-black mt-1">
                  {stats?.approvers_count ?? 0} / {stats?.executive_duties_count ?? 0}
                </p>
                <p className="text-[11px] text-orange-200 mt-0.5">สายอนุมัติและหน้าที่บริหารที่ปฏิบัติอยู่</p>
              </div>
              <div className="stat-icon-box">
                <i className="fa-solid fa-user-tie" />
              </div>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bma-card p-5">
            <h3 className="font-extrabold text-sm mb-4">จำนวนบุคลากรแยกตามสำนักงาน/กอง</h3>
            <div className="h-64">
              <Bar data={barData} options={{ responsive: true, maintainAspectRatio: false }} />
            </div>
          </div>

          <div className="lg:col-span-5 bma-card p-5">
            <h3 className="font-extrabold text-sm mb-4">สัดส่วนตามประเภทตำแหน่ง</h3>
            <div className="h-64 flex items-center justify-center">
              <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false }} />
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
