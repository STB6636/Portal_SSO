import { useMemo } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { cleanDisplaySegment } from '@/lib/positionFormatter';

export function useScopedPermissions() {
  const user = useAuthStore((s) => s.user);

  return useMemo(() => {
    const role = user?.role ?? null;
    const isSuperAdmin = role === 'SUPERADMIN';
    const isAdmin = role === 'ADMIN';
    const isUser = role === 'USER';
    const isAdminOrAbove = isSuperAdmin || isAdmin;
    const adminScope = isAdmin ? user?.admin_scope ?? null : null;
    const isOfficeAdmin = isAdmin && adminScope?.scope_level_no === 2;
    const isDepartmentAdmin = isAdmin && adminScope?.scope_level_no === 3;

    const scopeOrgName = cleanDisplaySegment(adminScope?.org_unit_name) || '-';
    const userOrgLabel =
      cleanDisplaySegment(user?.department_name) || cleanDisplaySegment(user?.office_name) || 'ผู้ใช้งานทั่วไป';

    const scopeLabel = isSuperAdmin
      ? 'ทุกสังกัดทั้งหน่วยงาน'
      : isOfficeAdmin
        ? `สำนักงาน/กอง: ${scopeOrgName}`
        : isDepartmentAdmin
          ? `ส่วน/ฝ่าย: ${scopeOrgName}`
          : userOrgLabel;

    const isOrgInMyScope = (officeId?: string | null, departmentId?: string | null): boolean => {
      if (isSuperAdmin) return true;
      if (isOfficeAdmin && adminScope) {
        return Boolean(officeId && officeId === adminScope.org_unit_id);
      }
      if (isDepartmentAdmin && adminScope) {
        return Boolean(departmentId && departmentId === adminScope.org_unit_id);
      }
      return false;
    };

    return {
      user,
      role,
      isSuperAdmin,
      isAdmin,
      isUser,
      isAdminOrAbove,
      adminScope,
      isOfficeAdmin,
      isDepartmentAdmin,
      scopeLabel,
      isOrgInMyScope,
    };
  }, [user]);
}
