# คู่มือสถาปัตยกรรมและการพัฒนาเว็บแอปย่อย (Sub-App Developer Guide)

> **เวอร์ชันอ้างอิง:** Portal SSO v2.4.0 (`public` Schema — 35 ตาราง 3NF + Read-Only Contract `v_decoration_hr_source`)  
> **สถาปัตยกรรมที่ได้รับอนุมัติ:** แยก GitHub Repo ต่อแอป + แยก Cloudflare Pages Project ต่อแอป (ฟรี 0 บาท) + ใช้ Supabase โปรเจกต์เดียวกันแบบ Multi-Schema  
> **คู่มือ API ฉบับเต็ม (ครบทุก Endpoint, Auth Mode A/B, PDPA Scopes และตัวอย่าง SDK):** ดูรายละเอียดเพิ่มเติมที่ [PORTAL_API_GUIDE.md](./PORTAL_API_GUIDE.md)

---

## 1. ภาพรวมสถาปัตยกรรม (Single Supabase Project, Multi-Schema, Multi-Repo)

```text
Supabase Project เดียวกัน (Single Auth + Single Core HR)
 ├── Schema: auth              ← Supabase Auth (ผู้ใช้ล็อกอินครั้งเดียวที่ Portal SSO)
 ├── Schema: public            ← Portal SSO Core HR & Identity (35 ตาราง — Owner: Portal SSO)
 │     └── View: public.v_decoration_hr_source (Read-Only Contract สำหรับแอปเครื่องราชฯ)
 ├── Schema: decoration_app    ← แอปย่อยเครื่องราชอิสริยาภรณ์ กทม. (6 ตารางเฉพาะทาง)
 ├── Schema: vehicle_tax_app   ← แอปย่อยต่อภาษีรถราชการ (อนาคต)
 └── Schema: car_request_app   ← แอปย่อยใบขออนุญาตใช้รถ (อนาคต)
```

### กฎเหล็ก (Boundaries & Separation of Concerns)
1. **Portal SSO (`public`) เป็นเจ้าของข้อมูลบุคลากรและสิทธิ์ทั้งหมด (Single Source of Truth)** — แอปย่อย **ห้าม** เขียนแก้ไขตารางใน `public` โดยตรง ให้อ่านผ่าน View Read-Only (`public.v_decoration_hr_source`) หรือ Central REST API (`portal-api`) เท่านั้น
2. **ตารางเฉพาะทางของแอปย่อยให้สร้างใน Schema ของแอปนั้นเท่านั้น** เช่น `decoration_app.annual_cycle_config`, `decoration_app.salary_threshold_config`, `decoration_app.eligibility_rule_matrix`, `decoration_app.nomination_transactions`, `decoration_app.decoration_notification_logs` และผูก Cross-Schema FK ไปที่ `public.personnel(id) ON DELETE RESTRICT`
3. **Zero Double Login:** แอปย่อยใช้ Supabase Project เดียวกัน เมื่อรับ `?sso_token=...` จาก Portal SSO ให้แลกผ่าน `POST /sso/exchange` → รับ `otp_hash` → เรียก `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` จะได้ Supabase Session ของผู้ใช้คนเดิมทันที

---

## 2. การตั้งค่า Supabase Multi-Schema สำหรับแอปย่อยใหม่

### 2.1 SQL Migration ตั้งต้นของแอปย่อย (ตัวอย่าง `decoration_app`)
```sql
CREATE SCHEMA IF NOT EXISTS decoration_app;

-- เปิดสิทธิ์ให้ Role authenticated ใช้งาน Schema แอปย่อย
GRANT USAGE ON SCHEMA decoration_app TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA decoration_app TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA decoration_app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- อนุญาตให้อ่าน Read-Only HR Contract จาก public
GRANT SELECT ON public.v_decoration_hr_source TO authenticated;

-- ตัวอย่างตารางเฉพาะทางที่ผูก Cross-Schema FK กับ public.personnel
CREATE TABLE IF NOT EXISTS decoration_app.nomination_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_year_be smallint NOT NULL,
  person_id uuid NOT NULL REFERENCES public.personnel(id) ON DELETE RESTRICT,
  target_decoration_group text NOT NULL,
  calculated_tier_code text,
  eligibility_status text NOT NULL,
  rule_evaluation_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_stage text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- เปิด Scoped RLS โดยเรียกใช้ฟังก์ชันกลางของ Portal SSO ได้โดยตรง!
ALTER TABLE decoration_app.nomination_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scoped_select_nominations"
  ON decoration_app.nomination_transactions
  FOR SELECT TO authenticated
  USING (public.fn_is_personnel_in_my_scope(person_id));
```

### 2.2 เปิด PostgREST Exposed Schemas ใน Supabase Dashboard
1. ไปที่ **Supabase Dashboard → `Project Settings` → `Data API` → `Exposed schemas`**
2. เพิ่มชื่อ Schema ของแอปย่อยต่อท้าย `public` เช่น: `public, decoration_app`
3. กด **Save**

---

## 3. การตั้งค่า GitHub Repo & Cloudflare Pages Project (ฟรี 0 บาท)

### 3.1 สร้าง Repository แยก 1 แอป = 1 Repo
- ตั้งชื่อมาตรฐาน เช่น `BMA_Royal_Decoration`, `BMA_Car_Request`, `BMA_Vehicle_Tax`
- คัดลอกไฟล์ Starter จาก `Portal SSO` มาใช้ต่อได้ทันที:
  - `sdk/portal-sso-sdk.ts` (เชื่อมต่อ `portal-api`)
  - `src/lib/thaiDate.ts` (วันเดือนปี พ.ศ. + โซนเวลา `Asia/Bangkok` + กฎวันเกิด 1 ต.ค.)
  - `src/components/common/ThaiDatePicker.tsx` (ปฏิทิน พ.ศ. Portal Popover)
  - ธีมสี BMA Theme V2.5 (`Sarabun` + Font Awesome 6 Free)

### 3.2 ไฟล์บังคับสำหรับ Cloudflare Pages
- **`public/_redirects`** (รองรับ SPA BrowserRouter):
  ```text
  /* /index.html 200
  ```
- **`public/_headers`** (Security Headers):
  ```text
  /*
    X-Frame-Options: DENY
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
  ```

### 3.3 Environment Variables ของแอปย่อย (ตั้งใน `.env.local` และ Cloudflare Pages Dashboard)
```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
VITE_SUPABASE_SCHEMA=decoration_app
VITE_PORTAL_API_URL=https://<your-project-ref>.supabase.co/functions/v1/portal-api
VITE_APP_CODE=ROYAL_DEC
VITE_ROUTER_MODE=browser
VITE_BASE_PATH=/
```

> **หมายเหตุค่าใช้จ่าย:** Cloudflare Pages Free Tier ให้สร้าง Project ได้ไม่จำกัด, Bandwidth ไม่จำกัด (500 builds/เดือน รวมทุก Project) และสามารถใช้โดเมน `*.pages.dev` ฟรี หรือผูก Subdomain ใต้โดเมนหน่วยงานเดิมได้ฟรีโดยไม่ต้องซื้อโดเมนใหม่

---

## 4. การเขียนโค้ดเชื่อมต่อ Supabase Multi-Schema & SSO Callback

### 4.1 สร้าง Supabase Client แยก Schema (`src/lib/supabaseClient.ts` ของแอปย่อย)
```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    db: { schema: import.meta.env.VITE_SUPABASE_SCHEMA || 'decoration_app' },
  }
);

// อ่านข้อมูล HR กลางแบบ Read-Only จาก public.v_decoration_hr_source
export async function fetchDecorationHrSource(officeId?: string) {
  let q = supabase.schema('public').from('v_decoration_hr_source').select('*');
  if (officeId) q = q.eq('office_id', officeId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
```

### 4.2 หน้า `/sso-callback` รับ Token จาก Portal SSO
```ts
import { PortalSsoClient } from '@/lib/portal-sso-sdk';
import { supabase } from '@/lib/supabaseClient';

const portalClient = new PortalSsoClient({
  portalApiUrl: import.meta.env.VITE_PORTAL_API_URL,
  appCode: import.meta.env.VITE_APP_CODE,
});

export async function handleSsoCallback(ssoToken: string) {
  // 1. แลก One-Time SSO Token (อายุ 5 นาที) เป็น otp_hash + app_permission
  const res = await portalClient.exchangeSsoToken(ssoToken) as {
    otp_hash?: string;
    app_permission?: { role_code: string; role_name_th: string; hierarchy_level: number };
  };

  if (!res.otp_hash) {
    throw new Error('ไม่สามารถออก Session OTP จาก Portal SSO ได้');
  }

  // 2. ยืนยันตัวตนกับ Supabase Auth (ได้ JWT Session เดียวกับ Portal SSO)
  const { error } = await supabase.auth.verifyOtp({
    token_hash: res.otp_hash,
    type: 'magiclink',
  });
  if (error) throw error;

  return res.app_permission;
}
```

### 4.3 การดึงข้อมูลผ่าน `portal-api` และนโยบาย PDPA Scope Filtering
- **Endpoint ทั่วไป** (`/sso/verify`, `/sso/exchange`, `/me`, `/personnel`, `/personnel/{id}`, `/personnel/batch`, `/personnel/approvers`):
  - ส่งเฉพาะ `cid_masked` (พรางเลขบัตรประชาชนตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล)
  - ซ่อนฟิลด์เงินเดือน/วินัยหากแอปไม่มี Scope `personnel:sensitive`
  - ซ่อนฟิลด์วันบรรจุ/ประวัติราชการหากไม่มี Scope `personnel:career`
  - ลบ `signature_path` ดิบและคืน `signature_url: null` หากไม่มี Scope `personnel:signature`
  - *(หมายเหตุ: `/personnel/drivers` และ `/personnel/decoration-profiles` ถูกยกเลิกตั้งแต่ Migration `014` และคืน `410 Gone`)*
- **Endpoint เฉพาะทางสำหรับแอปเครื่องราชฯ (`GET /personnel/decoration-source`)**:
  - บังคับให้แอปต้องถือ Scope ทั้ง `personnel:career` และ `personnel:sensitive` (ใช้ Preset `ROYAL_DEC`)
  - รองรับตัวกรอง `?office_id=...&department_id=...&person_id=...`
  - เรียกผ่าน TypeScript SDK ได้ด้วย `portalClient.getDecorationSource({ officeId })` หรือผ่าน GAS SDK ด้วย `PortalSSO.getDecorationSource(officeId, departmentId, personId)`

---

## 5. 6 ขั้นตอนการออก URL และลงทะเบียนแอปย่อยใน Portal SSO

1. **เตรียม Schema ใน Supabase:** รัน Migration ของแอปย่อย (`decoration_app`) และเพิ่มชื่อ Schema ใน `Data API → Exposed schemas`
2. **พัฒนาและทดสอบหน้า `/sso-callback`:** ทดสอบรับ `?sso_token=...` บน `http://localhost:5174/sso-callback`
3. **Deploy ขึ้น Cloudflare Pages Project ใหม่:** เชื่อม GitHub Repo ใหม่ + ตั้ง Environment Variables → ได้ URL เช่น `https://<your-subapp>.pages.dev` (หรือ `https://royaldec.<your-domain>`)
4. **ลงทะเบียนใน Portal SSO (`/admin/webapps`):**
   - กด **`+ ลงทะเบียนเว็บแอปใหม่`**
   - ระบุ `app_code` (เช่น `ROYAL_DEC`), `url` = `https://<your-subapp>.pages.dev/sso-callback`
   - เพิ่ม `allowed_origins` (`https://<your-subapp>.pages.dev` และ `http://localhost:5174` ช่วงพัฒนา)
   - เลือก Scope Preset **`ROYAL_DEC`**
   - นิยาม Roles ภายในแอป (เช่น `STAFF`, `HR_ADMIN`, `APPROVER`, `APP_ADMIN`)
5. **กำหนดสิทธิ์ผู้ใช้งาน (`/admin/app-access`):** เปิดสิทธิ์และกำหนดระดับสิทธิ์ให้บุคลากรและเจ้าหน้าที่ HR ตามขอบเขตสังกัด
6. **ทดสอบ End-to-End:** ล็อกอินเข้า Portal SSO → กดเปิดการ์ดแอปจากหน้า **`/apps`** → ระบบสร้าง `sso_token` พาเข้าแอปย่อยพร้อม Session และ Role ทันที
