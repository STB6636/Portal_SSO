import Swal, { type SweetAlertIcon } from 'sweetalert2';

export interface ConfirmLogoutOptions {
  fullName?: string | null;
  username?: string | null;
  role?: string | null;
  bureauName?: string | null;
}

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildLogoutDialogHtml(options?: ConfirmLogoutOptions): string {
  const safeName = escapeHtml((options?.fullName || options?.username || 'ผู้ใช้งานระบบ').trim());
  const safeUsername = options?.username ? escapeHtml(options.username.trim()) : '';
  const safeRole = options?.role ? escapeHtml(options.role.trim()) : '';
  const safeBureau = escapeHtml((options?.bureauName || 'Portal SSO').trim());

  const roleBadgeHtml = safeRole
    ? `<span class="bma-swal-logout-role">${safeRole}</span>`
    : '';
  const subIdentity =
    safeUsername && safeUsername !== safeName
      ? `<span class="bma-swal-logout-username">@${safeUsername}</span>`
      : '';

  return `
    <div class="bma-swal-logout-shell">
      <div class="bma-swal-logout-header">
        <div class="bma-swal-logout-icon-ring">
          <i class="fa-solid fa-right-from-bracket"></i>
        </div>
        <h3 class="bma-swal-logout-title">ยืนยันการออกจากระบบ</h3>
        <p class="bma-swal-logout-subtitle">${safeBureau}</p>
      </div>
      <div class="bma-swal-logout-body">
        <div class="bma-swal-logout-user-pill">
          <span class="bma-swal-logout-user-avatar">
            <i class="fa-solid fa-user-shield"></i>
          </span>
          <div class="bma-swal-logout-user-meta">
            <div class="bma-swal-logout-user-name">${safeName}</div>
            <div class="bma-swal-logout-user-sub">
              ${subIdentity}
              ${roleBadgeHtml}
            </div>
          </div>
        </div>
        <p class="bma-swal-logout-message">
          คุณต้องการออกจากระบบ <strong>Portal SSO</strong> ในขณะนี้ใช่หรือไม่?
        </p>
        <p class="bma-swal-logout-hint">
          <i class="fa-solid fa-shield-halved"></i>
          <span>การออกจากระบบจะล้างโทเคนเซสชันในเบราว์เซอร์นี้อย่างปลอดภัย</span>
        </p>
      </div>
    </div>
  `;
}

export async function confirmLogout(options?: ConfirmLogoutOptions): Promise<boolean> {
  const isDark = document.documentElement.classList.contains('dark');
  const result = await Swal.fire({
    html: buildLogoutDialogHtml(options),
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-right-from-bracket mr-1.5"></i>ออกจากระบบทันที',
    cancelButtonText: '<i class="fa-solid fa-arrow-left mr-1.5"></i>อยู่ในระบบต่อ',
    reverseButtons: true,
    focusCancel: true,
    buttonsStyling: false,
    padding: 0,
    width: '26rem',
    background: isDark ? '#0F1E2E' : '#FFFFFF',
    color: isDark ? '#F1F5F9' : '#1E293B',
    backdrop: 'rgba(2, 20, 13, 0.72)',
    customClass: {
      popup: 'bma-swal-logout-popup',
      htmlContainer: 'bma-swal-logout-html',
      actions: 'bma-swal-logout-actions',
      confirmButton: 'bma-swal-btn-danger',
      cancelButton: 'bma-swal-btn-cancel',
    },
  });
  return Boolean(result.isConfirmed);
}

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
    customClass: {
      popup: 'bma-swal-standard-popup',
    },
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
    customClass: {
      popup: 'bma-swal-standard-popup',
    },
  });
}

export async function showDriveNotConfiguredAlert(
  missingLabel: string,
  isSuperAdmin: boolean,
  onGoToSettings?: () => void
): Promise<void> {
  const isDark = document.documentElement.classList.contains('dark');
  const safeLabel = escapeHtml(missingLabel);
  const res = await Swal.fire({
    title: 'ยังไม่ได้ตั้งค่าลิงก์ Google Drive',
    html: `<p class="text-sm leading-relaxed">ไม่พบการตั้งค่า <strong>${safeLabel}</strong> สำหรับจัดเก็บไฟล์บน Google Drive<br/>กรุณาแจ้งผู้ดูแลระบบ (SUPERADMIN) ไปบันทึกลิงก์ Google Drive ในหน้าตั้งค่าระบบ (<code>/settings/system</code>) ก่อนอัปโหลดไฟล์</p>`,
    icon: 'warning',
    showCancelButton: isSuperAdmin && Boolean(onGoToSettings),
    confirmButtonText: isSuperAdmin && onGoToSettings ? 'ไปหน้าตั้งค่าระบบ' : 'รับทราบ',
    cancelButtonText: 'ปิด',
    confirmButtonColor: '#00744B',
    cancelButtonColor: '#64748B',
    background: isDark ? '#11231B' : '#FFFFFF',
    color: isDark ? '#F1F5F9' : '#1E293B',
    customClass: {
      popup: 'bma-swal-standard-popup',
    },
  });
  if (res.isConfirmed && isSuperAdmin && onGoToSettings) {
    onGoToSettings();
  }
}
