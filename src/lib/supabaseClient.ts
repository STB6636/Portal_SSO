import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
export const SUPABASE_PUBLISHABLE_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
).trim();
export const SUPABASE_SCHEMA = String(import.meta.env.VITE_SUPABASE_SCHEMA || 'public').trim() || 'public';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_URL.includes('<your-project-ref>') &&
    !SUPABASE_PUBLISHABLE_KEY.includes('<your-publishable-key>')
);

const FALLBACK_URL = 'https://placeholder.supabase.co';
const FALLBACK_KEY = 'sb_publishable_placeholder_not_configured';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any, any, any> = createClient(
  SUPABASE_URL || FALLBACK_URL,
  SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY,
  {
    db: {
      schema: SUPABASE_SCHEMA,
    },
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

export function getEdgeFunctionUrl(functionName: string, subPath = ''): string {
  const base = (SUPABASE_URL || FALLBACK_URL).replace(/\/+$/, '');
  const cleanSub = subPath ? (subPath.startsWith('/') ? subPath : `/${subPath}`) : '';
  return `${base}/functions/v1/${functionName}${cleanSub}`;
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  subPath: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    requireAuth?: boolean;
    extraHeaders?: Record<string, string>;
  } = {}
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase (.env.local)');
  }
  const { method = 'POST', body, requireAuth = true, extraHeaders = {} } = options;
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    ...extraHeaders,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (requireAuth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(getEdgeFunctionUrl(functionName, subPath), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (payload && (payload.message || payload.error)) ||
      `Edge Function ${functionName}${subPath} failed (${res.status})`;
    throw new Error(String(msg));
  }
  return payload as T;
}
