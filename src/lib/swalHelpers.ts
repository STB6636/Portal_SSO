import Swal, { type SweetAlertIcon } from 'sweetalert2';

export async function confirmAction(
  title: string,
  text: string,
  confirmButtonText = 'ยืนยัน',
  icon: SweetAlertIcon = 'question',
  cancelButtonText = 'ยกเลิก'
): Promise<boolean> {
  const isDark = document.documentElement.classList.contains('dark');
  const result = await Swal.fire({
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor: icon === 'warning' || icon === 'error' ? '#DC2626' : '#00744B',
    cancelButtonColor: '#64748B',
    background: isDark ? '#11231B' : '#FFFFFF',
    color: isDark ? '#F1F5F9' : '#1E293B',
    reverseButtons: true,
  });
  return Boolean(result.isConfirmed);
}

export async function showAlert(
  title: string,
  text: string,
  icon: SweetAlertIcon = 'info',
  confirmButtonText = 'ตกลง'
): Promise<void> {
  const isDark = document.documentElement.classList.contains('dark');
  await Swal.fire({
    title,
    text,
    icon,
    confirmButtonText,
    confirmButtonColor: '#00744B',
    background: isDark ? '#11231B' : '#FFFFFF',
    color: isDark ? '#F1F5F9' : '#1E293B',
  });
}

export async function showDriveNotConfiguredAlert(
  missingLabel: string,
  isSuperAdmin: boolean,
  onGoToSettings?: () => void
): Promise<void> {
  const isDark = document.documentElement.classList.contains('dark');
  const res = await Swal.fire({
    title: 'ยังไม่ได้ตั้งค่าลิงก์ Google Drive',
    html: `<p class="text-sm leading-relaxed">ไม่พบการตั้งค่า <strong>${missingLabel}</strong> สำหรับจัดเก็บไฟล์บน Google Drive<br/>กรุณาแจ้งผู้ดูแลระบบ (SUPERADMIN) ไปบันทึกลิงก์ Google Drive ในหน้าตั้งค่าระบบ (<code>/settings/system</code>) ก่อนอัปโหลดไฟล์</p>`,
    icon: 'warning',
    showCancelButton: isSuperAdmin && Boolean(onGoToSettings),
    confirmButtonText: isSuperAdmin && onGoToSettings ? 'ไปหน้าตั้งค่าระบบ' : 'รับทราบ',
    cancelButtonText: 'ปิด',
    confirmButtonColor: '#00744B',
    cancelButtonColor: '#64748B',
    background: isDark ? '#11231B' : '#FFFFFF',
    color: isDark ? '#F1F5F9' : '#1E293B',
  });
  if (res.isConfirmed && isSuperAdmin && onGoToSettings) {
    onGoToSettings();
  }
}
