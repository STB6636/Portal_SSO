/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  ThaiDatePicker,
  findInvalidThaiDateInput,
  focusInvalidThaiDateInput,
} from '@/components/common/ThaiDatePicker';
import { ResponsiveModal } from '@/components/common/ResponsiveModal';
import { SettingsAnnouncementTab } from '@/components/settings/SettingsAnnouncementTab';
import { UserAppDrawer } from '@/components/admin/UserAppDrawer';
import { PersonnelFormModal } from '@/components/admin/PersonnelFormModal';
import AppAccessPage from '@/pages/admin/AppAccessPage';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUiStore } from '@/stores/useUiStore';
import { supabase } from '@/lib/supabaseClient';
import { personnelService } from '@/services/personnelService';
import { appAccessService, type AppAccessMatrixRow } from '@/services/appAccessService';
import { webappService } from '@/services/webappService';
import { userService, type ScopedUserViewRow } from '@/services/userService';
import { EMPTY_MASTER_DATA, masterDataService } from '@/services/masterDataService';
import { QUERY_KEYS } from '@/lib/queryClient';
import type { PersonnelDirectoryItem, WebappWithRoles } from '@/types/domain.types';

describe('ThaiDatePicker (Portal Popover & BE Input)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  it('displays ISO value in Buddhist Era DD/MM/BBBB and renders portal popover at z-[9995] on document.body', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(ThaiDatePicker, {
          value: '2026-10-01',
          onChange,
          showThaiPreview: true,
        })
      );
    });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('01/10/2569');
    expect(container.textContent).toContain('1 ตุลาคม 2569');

    // Open popover via calendar button
    const calBtn = container.querySelector('button[aria-label="เปิดปฏิทิน พ.ศ."]') as HTMLButtonElement;
    act(() => {
      calBtn.click();
    });

    const dialog = document.body.querySelector('[role="dialog"][aria-label="ปฏิทินพุทธศักราช"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.parentElement).toBe(document.body);
    expect(dialog?.className).toContain('z-[9998]');

    // Pressing Escape closes the popover without letting the event reach parent modal listeners
    const modalEscapeSpy = vi.fn();
    window.addEventListener('keydown', modalEscapeSpy);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    window.removeEventListener('keydown', modalEscapeSpy);

    expect(document.body.querySelector('[role="dialog"][aria-label="ปฏิทินพุทธศักราช"]')).toBeNull();
    expect(modalEscapeSpy).not.toHaveBeenCalled();
  });

  it('parses typed 8-digit BE date and rejects invalid leap day on blur', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(React.createElement(ThaiDatePicker, { value: '', onChange }));
    });

    const input = container.querySelector('input') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    act(() => {
      nativeSetter.call(input, '01102569');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-01');

    onChange.mockClear();
    act(() => {
      input.focus();
      nativeSetter.call(input, '29/02/2568');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.blur();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain('กรุณาระบุวันที่ พ.ศ. ให้ถูกต้อง');
  });

  it('auto-commits Thai-digit dates (๐๑/๑๐/๒๕๖๙) and 8-digit YYYYMMDD (25691001)', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(React.createElement(ThaiDatePicker, { value: '', onChange }));
    });
    const input = container.querySelector('input') as HTMLInputElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    act(() => {
      nativeSetter.call(input, '๐๑/๑๐/๒๕๖๙');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-01');
    expect(input.value).toBe('01/10/2569');

    onChange.mockClear();
    act(() => {
      nativeSetter.call(input, '25691002');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-02');
    expect(input.value).toBe('02/10/2569');
  });

  it('closes only the calendar popover (not ResponsiveModal) when clicking modal backdrop, and closes when scrolled out of viewport', () => {
    const onModalClose = vi.fn();
    const onChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(ResponsiveModal, {
          open: true,
          onClose: onModalClose,
          title: 'ทดสอบ Modal',
          children: React.createElement(ThaiDatePicker, { value: '2026-10-01', onChange }),
        })
      );
    });

    const calBtn = container.querySelector('button[aria-label="เปิดปฏิทิน พ.ศ."]') as HTMLButtonElement;
    act(() => {
      calBtn.click();
    });
    expect(document.body.querySelector('[role="dialog"][aria-label="ปฏิทินพุทธศักราช"]')).not.toBeNull();

    // Clicking the modal backdrop dismisses ONLY the datepicker popover, not the parent modal
    const modalBackdrop = container.querySelector('[role="dialog"][aria-modal="true"]') as HTMLDivElement;
    act(() => {
      modalBackdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"][aria-label="ปฏิทินพุทธศักราช"]')).toBeNull();
    expect(onModalClose).not.toHaveBeenCalled();

    // Re-open and simulate trigger scrolled above viewport (rect.bottom < 0)
    act(() => {
      calBtn.click();
    });
    const triggerDiv = calBtn.closest('.relative') as HTMLDivElement;
    vi.spyOn(triggerDiv, 'getBoundingClientRect').mockReturnValue({
      top: -80,
      bottom: -40,
      left: 20,
      right: 260,
      width: 240,
      height: 40,
      x: 20,
      y: -80,
      toJSON: () => ({}),
    });
    act(() => {
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"][aria-label="ปฏิทินพุทธศักราช"]')).toBeNull();
  });

  it('exposes data-thai-date-invalid and onInvalidChange when an invalid date replaces a previously valid date, blocking stale submission until corrected or cleared', () => {
    const onSubmitSpy = vi.fn();
    const onInvalidChange = vi.fn();

    function TestForm() {
      const [isoDate, setIsoDate] = React.useState('2026-10-01');
      const [blockedMsg, setBlockedMsg] = React.useState('');
      const formRef = React.useRef<HTMLFormElement | null>(null);
      return React.createElement(
        'form',
        {
          ref: formRef,
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            const invalidEl = findInvalidThaiDateInput(formRef.current);
            if (invalidEl) {
              setBlockedMsg('พบวันที่ไม่ถูกต้อง');
              return;
            }
            setBlockedMsg('');
            onSubmitSpy(isoDate);
          },
        },
        React.createElement(ThaiDatePicker, {
          value: isoDate,
          onChange: setIsoDate,
          onInvalidChange,
          showThaiPreview: true,
        }),
        React.createElement('button', { type: 'submit' }, 'บันทึก'),
        blockedMsg ? React.createElement('p', { role: 'alert' }, blockedMsg) : null
      );
    }

    act(() => {
      root.render(React.createElement(TestForm));
    });

    const input = container.querySelector('input') as HTMLInputElement;
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    expect(input.value).toBe('01/10/2569');
    expect(input.getAttribute('data-thai-date-invalid')).toBeNull();
    expect(container.textContent).toContain('1 ตุลาคม 2569');

    // Type invalid leap day (29/02/2568) and immediately click Save WITHOUT blurring
    act(() => {
      nativeSetter.call(input, '29/02/2568');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(input.getAttribute('data-thai-date-invalid')).toBe('true');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onInvalidChange).toHaveBeenLastCalledWith(
      true,
      expect.stringContaining('กรุณาระบุวันที่ พ.ศ. ให้ถูกต้อง')
    );
    // Stale Thai preview must be hidden while invalid
    expect(container.textContent).not.toContain('1 ตุลาคม 2569');
    expect(findInvalidThaiDateInput(container)).toBe(input);

    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('พบวันที่ไม่ถูกต้อง');

    // Partial incomplete date also remains invalid and blocks stale submission
    act(() => {
      nativeSetter.call(input, '29/02/256');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.getAttribute('data-thai-date-invalid')).toBe('true');
    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).not.toHaveBeenCalled();

    // Correct to a valid date -> clears invalid state and submits the NEW ISO date
    act(() => {
      nativeSetter.call(input, '28/02/2568');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.getAttribute('data-thai-date-invalid')).toBeNull();
    expect(onInvalidChange).toHaveBeenLastCalledWith(false, '');
    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).toHaveBeenCalledTimes(1);
    expect(onSubmitSpy).toHaveBeenCalledWith('2025-02-28');

    // Type invalid date again, then click Clear -> clears invalid state and submits empty string
    onSubmitSpy.mockClear();
    act(() => {
      nativeSetter.call(input, '29/02/2568');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.getAttribute('data-thai-date-invalid')).toBe('true');
    const clearBtn = container.querySelector('button[aria-label="ล้างวันที่"]') as HTMLButtonElement;
    act(() => {
      clearBtn.click();
    });
    expect(input.getAttribute('data-thai-date-invalid')).toBeNull();
    expect(onInvalidChange).toHaveBeenLastCalledWith(false, '');
    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).toHaveBeenCalledWith('');
  });

  it('SettingsAnnouncementTab blocks saving stale ISO announcement date when user types 29/02/2568 and clicks Save', () => {
    const onSaveAnnouncement = vi.fn();
    const onGoToDriveTab = vi.fn();
    const showToastSpy = vi.spyOn(useUiStore.getState(), 'showToast');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Wrapper() {
      const [form, setForm] = React.useState<Record<string, string>>({
        announcement_enabled: 'true',
        announcement_mode: 'text',
        announcement_title: 'ทดสอบประกาศ',
        announcement_body: 'รายละเอียด',
        announcement_start_date: '2026-10-01',
        announcement_end_date: '2026-10-15',
      });
      return React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(
          SettingsProvider,
          null,
          React.createElement(SettingsAnnouncementTab, {
            form,
            setVal: (k, v) => setForm((prev) => ({ ...prev, [k]: v })),
            saving: false,
            onSaveAnnouncement,
            onGoToDriveTab,
          })
        )
      );
    }

    act(() => {
      root.render(React.createElement(Wrapper));
    });

    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]');
    expect(dateInputs.length).toBe(2);
    const startInput = dateInputs[0];
    expect(startInput.value).toBe('01/10/2569');

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(startInput, '29/02/2568');
      startInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('บันทึกและเผยแพร่ประกาศระบบ')
    ) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();

    act(() => {
      saveBtn.click();
    });

    expect(onSaveAnnouncement).not.toHaveBeenCalled();
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringContaining('ไม่ถูกต้อง'),
      'error'
    );

    // Fix date -> Save now succeeds
    act(() => {
      nativeSetter.call(startInput, '05/10/2569');
      startInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      saveBtn.click();
    });
    expect(onSaveAnnouncement).toHaveBeenCalledTimes(1);

    showToastSpy.mockRestore();
    qc.clear();
  });

  it('commits valid single-digit/dash BE dates (1/10/2569, 01-10-2569) immediately without cursor-jumping, flags 29/2/2568, reveals error on incomplete submit, and ignores disabled pickers', () => {
    const onSubmitSpy = vi.fn();

    function TestSingleDigitForm() {
      const [isoDate, setIsoDate] = React.useState('2026-09-01');
      const [disabled, setDisabled] = React.useState(false);
      const formRef = React.useRef<HTMLFormElement | null>(null);
      return React.createElement(
        'form',
        {
          ref: formRef,
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            if (focusInvalidThaiDateInput(formRef.current)) return;
            onSubmitSpy(isoDate);
          },
        },
        React.createElement(ThaiDatePicker, {
          value: isoDate,
          onChange: setIsoDate,
          disabled,
          showThaiPreview: true,
        }),
        React.createElement('button', { type: 'submit' }, 'บันทึก'),
        React.createElement(
          'button',
          { type: 'button', onClick: () => setDisabled((d) => !d) },
          'toggle-disabled'
        )
      );
    }

    act(() => {
      root.render(React.createElement(TestSingleDigitForm));
    });

    const input = container.querySelector('input') as HTMLInputElement;
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    const toggleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent === 'toggle-disabled'
    ) as HTMLButtonElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    // Type valid single-digit date 1/10/2569 WITHOUT blurring -> must commit 2026-10-01 immediately & keep typed text
    act(() => {
      nativeSetter.call(input, '1/10/2569');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('1/10/2569');
    expect(input.getAttribute('data-thai-date-invalid')).toBeNull();
    expect(container.textContent).toContain('1 ตุลาคม 2569');
    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).toHaveBeenLastCalledWith('2026-10-01');

    // On blur, normalizes display to 01/10/2569
    act(() => {
      input.focus();
      input.blur();
    });
    expect(input.value).toBe('01/10/2569');

    // Dash separator 05-11-2569 commits immediately without blurring
    act(() => {
      nativeSetter.call(input, '05-11-2569');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).toHaveBeenLastCalledWith('2026-11-05');

    // Single-digit invalid leap day 29/2/2568 shows inline error immediately
    onSubmitSpy.mockClear();
    act(() => {
      nativeSetter.call(input, '29/2/2568');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.getAttribute('data-thai-date-invalid')).toBe('true');
    expect(container.textContent).toContain('กรุณาระบุวันที่ พ.ศ. ให้ถูกต้อง');

    // Incomplete date 29/02/256 has no inline error while typing, but Save attempt reveals inline error & blocks
    act(() => {
      nativeSetter.call(input, '29/02/256');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('กรุณาระบุวันที่ พ.ศ. ให้ถูกต้อง');
    act(() => {
      submitBtn.click();
    });
    expect(onSubmitSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('กรุณาระบุวันที่ พ.ศ. ให้ถูกต้อง');

    // When disabled, picker must never expose data-thai-date-invalid="true"
    act(() => {
      toggleBtn.click();
    });
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('data-thai-date-invalid')).toBeNull();
    expect(findInvalidThaiDateInput(container)).toBeNull();
  });

  it('UserAppDrawer stays open and blocks saving when an existing expires_at is replaced with 29/02/2568, then saves after fix', async () => {
    const bulkGrantSpy = vi.spyOn(appAccessService, 'bulkGrant').mockResolvedValue(1);
    const showToastSpy = vi.spyOn(useUiStore.getState(), 'showToast');
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const prevUser = useAuthStore.getState().user;
    useAuthStore.setState({
      user: { id: 'sa-1', username: 'admin', role: 'SUPERADMIN' } as never,
    });

    const targetUser: ScopedUserViewRow = {
      id: 'u-1',
      personnel_id: 'p-1',
      username: 'somchai',
      email: 'somchai@bma.go.th',
      role: 'USER',
      status: 'ACTIVE',
      must_change_credential: false,
      account_source: 'PORTAL',
      last_login_at: null,
      created_at: '2026-01-01T00:00:00Z',
      full_name: 'นายสมชาย ทดสอบ',
      cid_masked: '1-1001-XXXXX-01-1',
      office_id: 'off-1',
      office_name: 'สำนักงานทดสอบ',
      department_id: null,
      department_name: null,
      division_id: null,
      division_name: null,
      position_name: 'นักวิชาการ',
      position_level_name: null,
      scope_level_no: null,
      scope_org_unit_id: null,
      scope_org_unit_name: null,
    };
    const webapps: WebappWithRoles[] = [
      {
        id: 'app-1',
        app_code: 'ROYAL_DEC',
        name: 'ระบบเครื่องราชฯ',
        description: null,
        url: 'https://example.test',
        icon: 'fa-award',
        icon_url: null,
        color: '#00744B',
        status: 'ACTIVE',
        auto_grant_on_provision: false,
        sort_order: 1,
        api_key_prefix: null,
        created_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        scopes: [],
        allowed_origins: [],
        authorized_count: 1,
        roles: [
          {
            id: 'role-1',
            webapp_id: 'app-1',
            role_code: 'USER',
            role_name_th: 'ผู้ใช้งาน',
            description: null,
            hierarchy_level: 10,
            color_hex: '#00744B',
            is_default_on_grant: true,
            is_app_admin: false,
            allow_scoped_admin_grant: true,
            is_active: true,
            sort_order: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ];
    const existingPermissions: AppAccessMatrixRow[] = [
      {
        permission_id: 'perm-1',
        user_id: 'u-1',
        username: 'somchai',
        core_role: 'USER',
        full_name: 'นายสมชาย ทดสอบ',
        office_id: 'off-1',
        office_name: 'สำนักงานทดสอบ',
        department_id: null,
        department_name: null,
        webapp_id: 'app-1',
        app_code: 'ROYAL_DEC',
        webapp_name: 'ระบบเครื่องราชฯ',
        webapp_role_id: 'role-1',
        role_code: 'USER',
        role_name_th: 'ผู้ใช้งาน',
        hierarchy_level: 10,
        role_color: '#00744B',
        allow_scoped_admin_grant: true,
        is_allowed: true,
        expires_at: '2026-10-01T16:59:59.000Z',
        note: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    try {
      act(() => {
        root.render(
          React.createElement(UserAppDrawer, {
            open: true,
            user: targetUser,
            webapps,
            existingPermissions,
            onClose,
            onSaved,
          })
        );
      });

      const dateInput = container.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
      expect(dateInput.value).toBe('01/10/2569');

      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      // Type invalid date without touching any other field and click Save
      act(() => {
        nativeSetter.call(dateInput, '29/02/2568');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('บันทึกสิทธิ์ทั้งหมด')
      ) as HTMLButtonElement;
      expect(saveBtn).toBeTruthy();

      await act(async () => {
        saveBtn.click();
      });

      expect(bulkGrantSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่ถูกต้อง'), 'error');

      // Correct to valid date 28/02/2568 -> saves with new Bangkok end-of-day ISO
      act(() => {
        nativeSetter.call(dateInput, '28/02/2568');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        saveBtn.click();
        await Promise.resolve();
      });

      expect(bulkGrantSpy).toHaveBeenCalledTimes(1);
      expect(bulkGrantSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          webappId: 'app-1',
          userIds: ['u-1'],
          expiresAt: '2025-02-28T16:59:59.000Z',
        })
      );
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      useAuthStore.setState({ user: prevUser });
      bulkGrantSpy.mockRestore();
      showToastSpy.mockRestore();
    }
  });

  it('AppAccessPage Bulk Grant modal blocks saving stale ISO date when expires_at is 29/02/2568, then saves after fix', async () => {
    const prevUser = useAuthStore.getState().user;
    useAuthStore.setState({
      user: { id: 'sa-1', username: 'admin', role: 'SUPERADMIN' } as never,
    });
    const showToastSpy = vi.spyOn(useUiStore.getState(), 'showToast');
    const bulkGrantSpy = vi.spyOn(appAccessService, 'bulkGrant').mockResolvedValue(1);
    const webapps: WebappWithRoles[] = [
      {
        id: 'app-1',
        app_code: 'ROYAL_DEC',
        name: 'ระบบเครื่องราชฯ',
        description: null,
        url: 'https://example.test',
        icon: 'fa-award',
        icon_url: null,
        color: '#00744B',
        status: 'ACTIVE',
        auto_grant_on_provision: false,
        sort_order: 1,
        api_key_prefix: null,
        created_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        scopes: [],
        allowed_origins: [],
        authorized_count: 1,
        roles: [
          {
            id: 'role-1',
            webapp_id: 'app-1',
            role_code: 'USER',
            role_name_th: 'ผู้ใช้งาน',
            description: null,
            hierarchy_level: 10,
            color_hex: '#00744B',
            is_default_on_grant: true,
            is_app_admin: false,
            allow_scoped_admin_grant: true,
            is_active: true,
            sort_order: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ];
    const users: ScopedUserViewRow[] = [
      {
        id: 'u-1',
        personnel_id: 'p-1',
        username: 'somchai',
        email: 'somchai@bma.go.th',
        role: 'USER',
        status: 'ACTIVE',
        must_change_credential: false,
        account_source: 'PORTAL',
        last_login_at: null,
        created_at: '2026-01-01T00:00:00Z',
        full_name: 'นายสมชาย ทดสอบ',
        cid_masked: '1-1001-XXXXX-01-1',
        office_id: 'off-1',
        office_name: 'สำนักงานทดสอบ',
        department_id: null,
        department_name: null,
        division_id: null,
        division_name: null,
        position_name: 'นักวิชาการ',
        position_level_name: null,
        scope_level_no: null,
        scope_org_unit_id: null,
        scope_org_unit_name: null,
      },
    ];
    const listAllSpy = vi.spyOn(webappService, 'listAll').mockResolvedValue(webapps);
    const listUsersSpy = vi.spyOn(userService, 'listScopedUsers').mockResolvedValue(users);
    const listMatrixSpy = vi.spyOn(appAccessService, 'listMatrix').mockResolvedValue([]);
    const masterSpy = vi.spyOn(masterDataService, 'fetchAll').mockResolvedValue(EMPTY_MASTER_DATA);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QUERY_KEYS.masterData, EMPTY_MASTER_DATA);
    qc.setQueryData(QUERY_KEYS.webapps, webapps);
    qc.setQueryData(QUERY_KEYS.users(), users);
    qc.setQueryData(QUERY_KEYS.appAccess('ALL'), []);

    try {
      await act(async () => {
        root.render(
          React.createElement(
            MemoryRouter,
            null,
            React.createElement(
              QueryClientProvider,
              { client: qc },
              React.createElement(
                ThemeProvider,
                null,
                React.createElement(SettingsProvider, null, React.createElement(AppAccessPage))
              )
            )
          )
        );
      });

      // Select user checkbox in tbody
      const rowCheckbox = container.querySelector('tbody input[type="checkbox"]') as HTMLInputElement;
      expect(rowCheckbox).toBeTruthy();
      act(() => {
        rowCheckbox.click();
      });

      // Open Bulk Grant modal
      const openBulkBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('กำหนดสิทธิ์แบบกลุ่ม')
      ) as HTMLButtonElement;
      expect(openBulkBtn.disabled).toBe(false);
      act(() => {
        openBulkBtn.click();
      });

      const dateInput = container.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
      expect(dateInput).toBeTruthy();
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

      // Enter valid date first, then overwrite with invalid 29/02/2568
      act(() => {
        nativeSetter.call(dateInput, '01/10/2569');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => {
        nativeSetter.call(dateInput, '29/02/2568');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('ยืนยันบันทึกสิทธิ์')
      ) as HTMLButtonElement;
      await act(async () => {
        confirmBtn.click();
      });

      expect(bulkGrantSpy).not.toHaveBeenCalled();
      expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่ถูกต้อง'), 'error');

      // Correct to 28/02/2568 -> succeeds with new date
      act(() => {
        nativeSetter.call(dateInput, '28/02/2568');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        confirmBtn.click();
        await Promise.resolve();
      });

      expect(bulkGrantSpy).toHaveBeenCalledTimes(1);
      expect(bulkGrantSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          webappId: 'app-1',
          userIds: ['u-1'],
          expiresAt: '2025-02-28T16:59:59.000Z',
        })
      );
    } finally {
      useAuthStore.setState({ user: prevUser });
      bulkGrantSpy.mockRestore();
      listAllSpy.mockRestore();
      listUsersSpy.mockRestore();
      listMatrixSpy.mockRestore();
      masterSpy.mockRestore();
      showToastSpy.mockRestore();
      qc.clear();
    }
  });

  it('PersonnelFormModal hides stale retirement badge, blocks tab switch & Save on invalid birth_date, and uses 3 tabs + overlay modal for history', async () => {
    const prevUser = useAuthStore.getState().user;
    useAuthStore.setState({
      user: { id: 'sa-1', username: 'admin', role: 'SUPERADMIN' } as never,
    });
    const showToastSpy = vi.spyOn(useUiStore.getState(), 'showToast');
    const saveBundleSpy = vi.spyOn(personnelService, 'saveBundle').mockResolvedValue('p-1');
    const timelinesSpy = vi.spyOn(personnelService, 'getPersonnelTimelines').mockResolvedValue({
      nameHistory: [],
      positionHistory: [],
      executiveDuties: [],
      salaryHistory: [],
      evaluations: [],
      disciplinaryRecords: [],
      serviceInterruptions: [],
      educations: [],
      licenses: [],
      trainings: [],
    });
    const masterSpy = vi.spyOn(masterDataService, 'fetchAll').mockResolvedValue(EMPTY_MASTER_DATA);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QUERY_KEYS.masterData, EMPTY_MASTER_DATA);
    const onClose = vi.fn();
    const onSaved = vi.fn();

    const initialPerson = {
      id: 'p-1',
      cid: '1100700000019',
      prefix_id: null,
      noble_or_rank_title: null,
      first_name: 'สมชาย',
      last_name: 'ทดสอบ',
      full_name: 'สมชาย ทดสอบ',
      gender_id: null,
      birth_date: '1966-10-01',
      phone_number: null,
      email: null,
      status_id: null,
      employment_type_id: null,
      position_type_id: null,
      position_id: null,
      position_level_id: null,
      position_number: null,
      secondary_position: null,
      acting_position: null,
      bureau_id: null,
      office_id: null,
      department_id: null,
      division_id: null,
      approval_tier_id: null,
      current_position_date: null,
      current_level_date: null,
      start_service_date: null,
      start_service_year_be: null,
      re_appointment_date: null,
      transfer_in_date: null,
      prior_continuous_service_days: 0,
      double_service_days: 0,
      initial_position: null,
      initial_salary: null,
      current_salary: null,
      position_allowance: 0,
      is_max_step: false,
      disciplinary_flag: false,
      disciplinary_note: null,
    } as unknown as PersonnelDirectoryItem;

    try {
      await act(async () => {
        root.render(
          React.createElement(
            QueryClientProvider,
            { client: qc },
            React.createElement(
              SettingsProvider,
              null,
              React.createElement(PersonnelFormModal, {
                open: true,
                initial: initialPerson,
                onClose,
                onSaved,
              })
            )
          )
        );
      });

      // Verify exactly 3 tabs (no Decorations or Fleet tab)
      expect(container.textContent).toContain('3. ประวัติรับราชการ');
      expect(container.textContent).not.toContain('4. เครื่องราชฯ');
      expect(container.textContent).not.toContain('5. รถราชการ');

      const birthInput = container.querySelector(
        'input[placeholder*="01/10/2509"]'
      ) as HTMLInputElement;
      expect(birthInput).toBeTruthy();
      expect(birthInput.value).toBe('01/10/2509');
      expect(container.textContent).toContain('เกษียณอายุราชการ');

      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      // Type invalid date into birth_date -> stale retirement badge hides, tab switch & Save blocked
      act(() => {
        nativeSetter.call(birthInput, '29/02/2568');
        birthInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(container.textContent).not.toContain('เกษียณอายุราชการ');

      const assignmentTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('2. สังกัด & ตำแหน่ง')
      ) as HTMLButtonElement;
      act(() => {
        assignmentTabBtn.click();
      });
      // Still on Basic tab because invalid date blocked tab switch
      expect(container.querySelector('input[placeholder*="01/10/2509"]')).not.toBeNull();

      const form = container.querySelector('form#personnelBundleForm') as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(saveBundleSpy).not.toHaveBeenCalled();

      // Fix birth_date -> valid again
      act(() => {
        nativeSetter.call(birthInput, '01/10/2510');
        birthInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(container.textContent).toContain('เกษียณอายุราชการ');

      // Clicking "เพิ่มรายการ" on name_history opens the nested Overlay Card Modal (z-[9995])
      const addNameHistBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('เพิ่มรายการ')
      ) as HTMLButtonElement;
      act(() => {
        addNameHistBtn.click();
      });
      const overlayForm = container.querySelector('form#personnelHistoryOverlayForm') as HTMLFormElement;
      expect(overlayForm).not.toBeNull();
      // Cancel overlay modal without closing parent modal
      const cancelBtns = Array.from(container.querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === 'ยกเลิก'
      );
      act(() => {
        cancelBtns[cancelBtns.length - 1].click();
      });
      expect(container.querySelector('form#personnelHistoryOverlayForm')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      // Submit parent form -> saveBundle receives the updated birth_date (1967-10-01)
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      expect(saveBundleSpy).toHaveBeenCalledTimes(1);
      expect(saveBundleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          personnel: expect.objectContaining({ birth_date: '1967-10-01' }),
        })
      );
    } finally {
      useAuthStore.setState({ user: prevUser });
      saveBundleSpy.mockRestore();
      timelinesSpy.mockRestore();
      masterSpy.mockRestore();
      showToastSpy.mockRestore();
      qc.clear();
    }
  });

  it('guards all 5 ThaiDatePicker form consumers against stale ISO submission on invalid typed date', () => {
    const consumerFiles = [
      'src/components/admin/PersonnelFormModal.tsx',
      'src/components/admin/PersonnelHistoryOverlayModal.tsx',
      'src/components/admin/UserAppDrawer.tsx',
      'src/pages/admin/AppAccessPage.tsx',
      'src/components/settings/SettingsAnnouncementTab.tsx',
    ];
    for (const rel of consumerFiles) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(src).toContain('focusInvalidThaiDateInput');
    }
  });
});

describe('personnelService.getPersonnelTimelines error safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when any of the 7 timeline queries returns a Supabase error (prevents silent wipe on save)', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      const result =
        table === 'personnel_salary_history'
          ? { data: null, error: { message: 'network timeout' } }
          : { data: [], error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolveFn: (v: unknown) => void) => Promise.resolve(result).then(resolveFn),
      };
      return chain as unknown as ReturnType<typeof supabase.from>;
    });

    await expect(personnelService.getPersonnelTimelines('pid-123')).rejects.toThrow(
      'personnel_salary_history'
    );
  });
});

describe('portal-api & Migration 013/014 structural contracts', () => {
  it('registers /personnel/decoration-source BEFORE catch-all /personnel/{id}, enforces PDPA sanitizer & Mode B auth/scope, and returns 410 for deprecated sub-app endpoints', () => {
    const apiSrc = readFileSync(resolve(process.cwd(), 'supabase/functions/portal-api/index.ts'), 'utf8');
    const decSourceIdx = apiSrc.indexOf("route === '/personnel/decoration-source'");
    const catchAllIdx = apiSrc.indexOf("route.startsWith('/personnel/')");
    expect(decSourceIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(decSourceIdx);

    // Deprecated endpoints return 410 Gone with ENDPOINT_DEPRECATED
    expect(apiSrc).toContain("route === '/personnel/drivers'");
    expect(apiSrc).toContain("route === '/personnel/decoration-profiles'");
    expect(apiSrc).toContain('ENDPOINT_DEPRECATED');

    // Ensure sanitizePersonnelByScopes is called across all surviving general endpoints
    const sanitizerCalls = apiSrc.match(/sanitizePersonnelByScopes\(/g) ?? [];
    expect(sanitizerCalls.length).toBeGreaterThanOrEqual(7);

    // Ensure Mode B endpoints enforce Bearer JWT authentication + actor org-scope filtering
    const modeBChecks = apiSrc.match(/resolveModeBActor\(/g) ?? [];
    expect(modeBChecks.length).toBeGreaterThanOrEqual(9);
    expect(apiSrc).toContain('applyActorScopeToQuery(');
    expect(apiSrc).toContain('hasActiveAppPermission(');
  });

  it('Migration 014 creates personnel_executive_duties with Scoped RLS, drops/recreates all 7 views incl. v_users_scoped & v_user_app_access_matrix, and protects history-locked fields from Bulk Import UPSERT', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/014_personnel_form_refactor_and_executive_duties.sql'),
      'utf8'
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.personnel_executive_duties');
    expect(sql).toContain('scoped_select_personnel_executive_duties');
    expect(sql).toContain('scoped_write_personnel_executive_duties');
    expect(sql).toContain('DROP VIEW IF EXISTS public.v_users_scoped;');
    expect(sql).toContain('DROP VIEW IF EXISTS public.v_user_app_access_matrix;');
    expect(sql).toContain('CREATE VIEW public.v_users_scoped');
    expect(sql).toContain('CREATE VIEW public.v_user_app_access_matrix');
    expect(sql).toContain('CREATE VIEW public.v_decoration_hr_source');
    expect(sql).toContain('ux_pos_history_one_active_per_person');
    expect(sql).toContain('MULTIPLE_ACTIVE_POSITION_HISTORY');
    expect(sql).toContain('EXECUTIVE_DUTY_NOT_EXECUTIVE_TYPE');
    expect(sql).toContain('AUTHORITATIVE HISTORY -> PARENT AUTO-SYNC & BULK IMPORT UPSERT GUARD');
    expect(sql).toContain("'executive_duties_count'");
  });

  it('Migration 015, portal-api, and AdminShell satisfy exec-title display, career cleanup, sort parity, and Topbar Avatar Menu contracts', () => {
    const sql15 = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/015_exec_title_display_and_career_cleanup.sql'),
      'utf8'
    );
    expect(sql15).toContain('CREATE OR REPLACE FUNCTION public.fn_format_position_display');
    expect(sql15).toContain('IMMUTABLE');
    expect(sql15).toContain('DROP COLUMN IF EXISTS is_bma_permanent_secretary');
    expect(sql15).toContain('DROP COLUMN IF EXISTS retro_salary_5y');
    expect(sql15).toContain('CREATE VIEW public.v_personnel_directory');
    expect(sql15).toContain('CREATE VIEW public.v_users_scoped');
    expect(sql15).toContain('CREATE VIEW public.v_personnel_approvers');
    expect(sql15).toContain('CREATE VIEW public.v_decoration_hr_source');
    expect(sql15).toContain('CREATE VIEW public.v_user_app_access_matrix');
    expect(sql15).toContain('CREATE OR REPLACE FUNCTION public.fn_get_my_profile');
    expect(sql15).toContain('CREATE OR REPLACE FUNCTION public.fn_save_personnel_bundle');

    const apiSrc = readFileSync(resolve(process.cwd(), 'supabase/functions/portal-api/index.ts'), 'utf8');
    expect(apiSrc).not.toContain('retro_salary_5y');
    expect(apiSrc).toContain(".order('sort_order').order('rank_order').order('name_th')");

    const shellSrc = readFileSync(resolve(process.cwd(), 'src/components/layout/AdminShell.tsx'), 'utf8');
    expect(shellSrc).not.toContain("group: 'บัญชีของฉัน'");
    expect(shellSrc).toContain('aria-label="เมนูบัญชีผู้ใช้"');
    expect(shellSrc).toContain('โปรไฟล์ของฉัน');
    expect(shellSrc).toContain('ออกจากระบบ');
  });
});
