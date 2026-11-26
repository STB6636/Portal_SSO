import { describe, expect, it } from 'vitest';
import {
  createUserRoleHierarchyComparator,
  getAccountRolePriority,
  getAccountRoleTag,
} from '@/lib/masterDataSort';
import { EMPTY_MASTER_DATA } from '@/services/masterDataService';

describe('User Role Hierarchy Comparator & Role TAG Classification', () => {
  it('classifies accounts into 4 Role TAGs accurately', () => {
    expect(getAccountRoleTag({ role: 'SUPERADMIN', scope_level_no: null })).toBe('SUPERADMIN');
    expect(getAccountRoleTag({ role: 'ADMIN', scope_level_no: 2 })).toBe('ADMIN_LV2');
    expect(getAccountRoleTag({ role: 'ADMIN', scope_level_no: 3 })).toBe('ADMIN_LV3');
    expect(getAccountRoleTag({ role: 'USER', scope_level_no: null })).toBe('USER');
  });

  it('orders accounts strictly: SuperAdmin -> Admin (Lv2) -> Admin (Lv3) -> Admin (unscoped) -> User', () => {
    expect(getAccountRolePriority({ role: 'SUPERADMIN', scope_level_no: null })).toBe(1);
    expect(getAccountRolePriority({ role: 'ADMIN', scope_level_no: 2 })).toBe(2);
    expect(getAccountRolePriority({ role: 'ADMIN', scope_level_no: 3 })).toBe(3);
    expect(getAccountRolePriority({ role: 'ADMIN', scope_level_no: null })).toBe(3.5);
    expect(getAccountRolePriority({ role: 'USER', scope_level_no: null })).toBe(4);

    const cmp = createUserRoleHierarchyComparator(EMPTY_MASTER_DATA);
    const unsorted = [
      { id: 'u1', username: 'user_b', role: 'USER', scope_level_no: null, full_name: 'นายข ทั่วไป' },
      { id: 'u2', username: 'admin_lv3', role: 'ADMIN', scope_level_no: 3, full_name: 'นายค ส่วนฝ่าย' },
      { id: 'u3', username: 'sa', role: 'SUPERADMIN', scope_level_no: null, full_name: 'นายก ผู้ดูแลสูงสุด' },
      { id: 'u4', username: 'admin_lv2', role: 'ADMIN', scope_level_no: 2, full_name: 'นายง สำนักงาน' },
      { id: 'u5', username: 'user_a', role: 'USER', scope_level_no: null, full_name: 'นายก ทั่วไป' },
    ];

    const sorted = [...unsorted].sort(cmp);
    expect(sorted.map((u) => u.id)).toEqual(['u3', 'u4', 'u2', 'u5', 'u1']);
  });
});
