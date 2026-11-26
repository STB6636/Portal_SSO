import { supabase, invokeEdgeFunction, isSupabaseConfigured } from '@/lib/supabaseClient';
import type { AuthUserProfile } from '@/types/domain.types';

export const setupService = {
  async isSystemInitialized(): Promise<boolean> {
    if (!isSupabaseConfigured) return true;
    const { data, error } = await supabase.rpc('fn_is_initialized');
    if (error) return true;
    return Boolean(data);
  },

  async initSuperAdmin(payload: {
    cid: string;
    username: string;
    email?: string;
    password: string;
    first_name: string;
    last_name: string;
    bureau_name?: string;
  }) {
    return invokeEdgeFunction<{ success: boolean; user_id: string; message: string }>(
      'portal-setup',
      '/init-superadmin',
      { method: 'POST', body: payload, requireAuth: false }
    );
  },
};

export const authService = {
  async loginWithIdentifier(identifier: string, password: string): Promise<AuthUserProfile> {
    const resolved = await invokeEdgeFunction<{ success: boolean; auth_email: string }>(
      'portal-auth',
      '/resolve-login',
      { method: 'POST', body: { identifier }, requireAuth: false }
    );

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: resolved.auth_email,
      password,
    });

    // Non-blocking audit of login attempt for brute-force protection
    void invokeEdgeFunction('portal-auth', '/record-login-attempt', {
      method: 'POST',
      body: { identifier, succeeded: !signInErr },
      requireAuth: false,
    }).catch(() => {});

    if (signInErr) {
      throw new Error('รหัสเข้าใช้ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    }

    const profile = await this.getMyProfile();
    if (!profile) {
      throw new Error('ไม่สามารถโหลดข้อมูลโปรไฟล์ผู้ใช้งานได้');
    }
    return profile;
  },

  async getMyProfile(): Promise<AuthUserProfile | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.rpc('fn_get_my_profile');
    if (error || !data) return null;
    return data as AuthUserProfile;
  },

  async changeCredential(newPassword: string) {
    return invokeEdgeFunction<{ success: boolean; message: string }>(
      'portal-auth',
      '/change-credential',
      { method: 'POST', body: { new_password: newPassword } }
    );
  },

  async sendEmailResetLink(email: string) {
    const redirectTo = `${window.location.origin}${window.location.pathname}#/reset-credential`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  },

  async submitForgotResetRequest(identifier: string, reason: string) {
    return invokeEdgeFunction<{ success: boolean; message: string }>(
      'portal-auth',
      '/forgot-request',
      { method: 'POST', body: { identifier, reason }, requireAuth: false }
    );
  },

  async approveResetRequest(requestId: string, approve: boolean, rejectReason?: string) {
    return invokeEdgeFunction<{ success: boolean; message: string; processed?: number }>(
      'portal-auth',
      '/approve-reset',
      { method: 'POST', body: { request_id: requestId, approve, reject_reason: rejectReason } }
    );
  },

  async approveResetRequestsBulk(requestIds: string[], approve: boolean, rejectReason?: string) {
    return invokeEdgeFunction<{
      success: boolean;
      processed: number;
      skipped: Array<{ id: string; reason: string }>;
      message: string;
    }>('portal-auth', '/approve-reset', {
      method: 'POST',
      body: { request_ids: requestIds, approve, reject_reason: rejectReason },
    });
  },
};
