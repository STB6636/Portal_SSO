# คู่มือพัฒนาและเชื่อมต่อ Portal SSO Central API สำหรับเว็บแอปย่อย (`PORTAL_API_GUIDE.md`)

> **เวอร์ชันอ้างอิง:** Portal SSO v2.4.0 (Migrations `001`–`015` Live)  
> **Edge Functions หลัก:** `portal-sso` (ออก Token) และ `portal-api` (Central REST API 14 Active Endpoints + 2 Deprecated)  
> **SDK พร้อมใช้:** TypeScript / Vite / React (`sdk/portal-sso-sdk.ts`) และ Google Apps Script (`sdk/PortalSSO.gs`)  
> **เอกสารคู่กัน:** [SUBAPP_DEVELOPER_GUIDE.md](./SUBAPP_DEVELOPER_GUIDE.md) (สถาปัตยกรรม Multi-Schema, Cloudflare Pages และขั้นตอนลงทะเบียนเว็บแอป)

---

## สารบัญ
1. [ภาพรวมสถาปัตยกรรมและการเลือกวิธีเชื่อมต่อ](#1-ภาพรวมสถาปัตยกรรมและการเลือกวิธีเชื่อมต่อ)
2. [การตั้งค่าก่อนเริ่มเชื่อมต่อ (Onboarding Checklist)](#2-การตั้งค่าก่อนเริ่มเชื่อมต่อ-onboarding-checklist)
3. [โหมดยืนยันตัวตนของเว็บแอป (Mode A vs Mode B)](#3-โหมดยืนยันตัวตนของเว็บแอป-mode-a-vs-mode-b)
4. [วงจร SSO Handshake แบบ Zero Double Login](#4-วงจร-sso-handshake-แบบ-zero-double-login)
5. [ตาราง API Scopes (7 สิทธิ์) และนโยบายคุ้มครองข้อมูล PDPA](#5-ตาราง-api-scopes-7-สิทธิ์-และนโยบายคุ้มครองข้อมูล-pdpa)
6. [เอกสารอ้างอิง API ครบทุก Endpoint (Endpoint Reference)](#6-เอกสารอ้างอิง-api-ครบทุก-endpoint-endpoint-reference)
7. [โครงสร้างข้อมูลที่คืนกลับ (Response Schemas)](#7-โครงสร้างข้อมูลที่คืนกลับ-response-schemas)
8. [การใช้งาน Dual SDKs และตัวอย่างโค้ดพร้อมใช้งานจริง](#8-การใช้งาน-dual-sdks-และตัวอย่างโค้ดพร้อมใช้งานจริง)
9. [การอ่านข้อมูลแบบ Cross-Schema Direct Read (สำหรับเว็บแอปบน Supabase เดียวกัน)](#9-การอ่านข้อมูลแบบ-cross-schema-direct-read-สำหรับเว็บแอปบน-supabase-เดียวกัน)
10. [รหัสสถานะ HTTP, การจัดการ Error และข้อควรระวังด้านความปลอดภัย](#10-รหัสสถานะ-http-การจัดการ-error-และข้อควรระวังด้านความปลอดภัย)

---

## 1. ภาพรวมสถาปัตยกรรมและการเลือกวิธีเชื่อมต่อ

Portal SSO (`public` Schema) ทำหน้าที่เป็น **Single Source of Truth** สำหรับข้อมูลบุคลากร โครงสร้างหน่วยงาน 4 ระดับ โครงสร้างตำแหน่ง การยืนยันตัวตน (SSO) และสิทธิ์การเข้าใช้งานเว็บแอปย่อย (RBAC)

```text
┌──────────────────────────────────────────────────────────────────────┐
│                      Portal SSO (Core Identity & HR)                 │
│  Base URL: https://<your-project-ref>.supabase.co/functions/v1       │
│   ├── /portal-sso   (ออก One-Time sso_token อายุ 5 นาที)            │
│   └── /portal-api   (Central REST API — 14 Active Endpoints)         │
└───────────────────┬───────────────────────────────┬──────────────────┘
                    │                               │
         [Mode B: Browser SPA]           [Mode A: Server / GAS]
       x-app-code + Bearer JWT                 x-app-key
        (+ Origin Whitelist)              (SHA-256 Verified)
                    │                               │
                    ▼                               ▼
     ┌────────────────────────────┐   ┌────────────────────────────┐
     │ React / Vite / Next.js SPA │   │ Backend Server / Node.js / │
     │ (Cloudflare Pages)         │   │ Google Apps Script (GAS)   │
     │ + Schema เฉพาะของแอป       │   │ + Script Properties Secret │
     └────────────────────────────┘   └────────────────────────────┘
```

### ตารางเปรียบเทียบช่องทางดึงข้อมูลสำหรับเว็บแอปย่อย

| ลักษณะงาน | ช่องทางที่แนะนำ | เหตุผล |
|:--|:--|:--|
| รับ SSO Login จาก Portal SSO (`?sso_token=...`) | `POST /portal-api/sso/exchange` (SPA) หรือ `POST /portal-api/sso/verify` (Server/GAS) | ตรวจสอบ One-Time Token (SHA-256) และสร้าง Session อัตโนมัติ |
| เว็บแอปย่อยบน **Google Apps Script (GAS)** หรือ **Backend Server** | `portal-api` (**Mode A**: `x-app-key`) ผ่าน `sdk/PortalSSO.gs` หรือ `sdk/portal-sso-sdk.ts` | เก็บ Secret Key ฝั่ง Server ได้ปลอดภัย 100% |
| เว็บแอปย่อย **React / Vite SPA** บน **Cloudflare Pages** | `portal-api` (**Mode B**: `x-app-code` + `Bearer JWT`) ผ่าน `sdk/portal-sso-sdk.ts` | ไม่ต้องฝัง Secret ในโค้ดหน้าเว็บ และถูกบังคับ Scoped RLS ตามสิทธิ์ผู้ใช้จริง |
| เว็บแอปย่อยที่ใช้ **Supabase โปรเจกต์เดียวกัน (Multi-Schema)** ต้องการ Query/Join ความเร็วสูง | อ่านตรงจาก Read-Only View (`public.v_decoration_hr_source`, `public.v_personnel_directory`) + ใช้ `public.fn_is_personnel_in_my_scope()` ใน RLS ของ Schema ตนเอง | เร็วระดับ PostgreSQL ตรง, ไม่ติด Limit 500 แถวของ REST Endpoint, และยังปลอดภัยด้วย `security_invoker = true` |

---

## 2. การตั้งค่าก่อนเริ่มเชื่อมต่อ (Onboarding Checklist)

ก่อนที่เว็บแอปย่อยจะเรียก `portal-api` ได้ ผู้ดูแลระดับ `SUPERADMIN` ต้องดำเนินการใน Portal SSO (`/admin/webapps`):

1. **ลงทะเบียนเว็บแอปใหม่** (`+ ลงทะเบียนเว็บแอปใหม่`):
   - `app_code`: รหัสแอปภาษาอังกฤษตัวพิมพ์ใหญ่ (เช่น `ROYAL_DEC`, `CAR_REQUEST`, `VEHICLE_TAX`)
   - `url`: URL ปลายทางสำหรับรับ SSO Callback (เช่น `https://<your-subapp>.pages.dev/sso-callback`)
   - `status`: ตั้งเป็น `ACTIVE` (หรือ `MAINTENANCE` ช่วงทดสอบ — หากเป็น `DISABLED` ทุก API Request จะถูกปฏิเสธด้วย `401`)
2. **นิยามระดับสิทธิ์ภายในแอป (`webapp_roles`)**:
   - สร้าง Role อย่างน้อย 1 ระดับ เช่น `STAFF` (level 10), `APPROVER` (level 30), `APP_ADMIN` (level 99)
3. **กำหนด `API Scopes` และ `Allowed Origins`**:
   - ติ๊กเลือกเฉพาะ Scopes ที่แอปจำเป็นต้องใช้จริงตามหลัก Least Privilege
   - เพิ่มโดเมนต้นทางใน `Allowed Origins` สำหรับ Mode B (เช่น `https://<your-subapp>.pages.dev` และ `http://localhost:5174` ช่วงพัฒนา — **ต้องไม่มี `/` ปิดท้าย**)
   - หากใช้ **Mode A (Server / GAS)** ให้กด **`สร้าง / หมุนเวียน API Key`** แล้วคัดลอกไปเก็บใน Environment Variable / Script Properties ทันที *(Portal SSO เก็บเฉพาะค่า SHA-256 Hash ไม่สามารถเปิดดูซ้ำได้)*
4. **มอบสิทธิ์ผู้ใช้งาน (`/admin/app-access`)**:
   - เปิดสิทธิ์ให้บุคลากรที่ต้องการทดสอบเข้าใช้งานเว็บแอปย่อย

---

## 3. โหมดยืนยันตัวตนของเว็บแอป (Mode A vs Mode B)

`portal-api` รองรับการยืนยันตัวตน 2 โหมด โดยตรวจสอบอัตโนมัติจาก HTTP Headers ที่ส่งมา:

### Mode A — Service-to-Service (Server Backend / Google Apps Script)
- **Headers ที่ต้องส่ง:**
  ```http
  x-app-key: <your-app-api-key>
  Content-Type: application/json
  ```
- **การตรวจสอบฝั่ง Server:** แปลง `x-app-key` เป็น SHA-256 แล้วเทียบกับ `webapps.api_key_hash`
- **ขอบเขตข้อมูล:** เข้าถึงข้อมูลได้ตาม Scopes ของเว็บแอปนั้นโดยไม่จำกัดเฉพาะผู้ใช้คนเดียว (เหมาะสำหรับ Backend API, Cron Sync, และ Google Apps Script)
- **⚠️ ข้อห้ามเด็ดขาด:** **ห้ามนำ `x-app-key` ใส่ในโค้ด Frontend / Browser / `VITE_*` เด็ดขาด!**

### Mode B — Browser SPA (React / Vite / Vue / Next.js Client)
- **Headers ที่ต้องส่ง:**
  ```http
  x-app-code: <YOUR_APP_CODE>
  Authorization: Bearer <supabase_user_access_token>
  Content-Type: application/json
  ```
- **การตรวจสอบฝั่ง Server 3 ชั้น:**
  1. ตรวจสอบ `x-app-code` ว่ามีอยู่จริงและสถานะไม่เป็น `DISABLED`
  2. ตรวจสอบ `Origin` Header ว่าตรงกับรายการใน `webapp_allowed_origins` (หากตั้งค่าไว้)
  3. ตรวจสอบ `Authorization: Bearer <JWT>` ตามระดับ Endpoint:
     - **ไม่ต้องส่ง Bearer JWT:** `POST /sso/exchange` และ `GET /app-roles` (ใช้ก่อนสร้าง Session)
     - **ต้องส่ง Bearer JWT ของผู้ใช้ Portal SSO (ไม่บังคับ `user_app_permissions`):** `GET /me` (คืน `app_permission: null` หากผู้ใช้ยังไม่มีสิทธิ์แอป), `GET /lookups`, `GET /org-units`, `GET /positions`
     - **ต้องส่ง Bearer JWT + มีสิทธิ์ใช้งานเว็บแอปนั้น (`user_app_permissions.is_allowed = true` และยังไม่หมดอายุ หรือเป็น `SUPERADMIN`):** `GET /authorized-users` และทุก Endpoint ในกลุ่ม `/personnel/*`
- **ขอบเขตข้อมูลอัตโนมัติ (Scoped RBAC):**
  - `SUPERADMIN` → เห็นข้อมูลทั้งหมด
  - `ADMIN` (ระดับสำนักงาน/กอง Lv2) → เห็นเฉพาะบุคลากร/ผู้ใช้ใน `office_id` ของตน
  - `ADMIN` (ระดับส่วน/ฝ่าย Lv3) → เห็นเฉพาะบุคลากร/ผู้ใช้ใน `department_id` ของตน
  - `USER` ทั่วไป → เห็นเฉพาะข้อมูลของตนเอง (`id = actor.personnel_id` สำหรับ `/personnel/*` และ `user_id = actor.id` สำหรับ `/authorized-users`) — *ยกเว้น `GET /personnel/approvers` ที่เปิดให้ผู้ใช้ทั่วไปค้นหารายชื่อผู้อนุมัติในระบบได้*

---

## 4. วงจร SSO Handshake แบบ Zero Double Login

```text
ผู้ใช้ (Browser)          Portal SSO               Edge: portal-sso         เว็บแอปย่อย (SPA / GAS)      Edge: portal-api
     │                        │                           │                           │                           │
     │ 1. คลิกการ์ดแอป (/apps) │                           │                           │                           │
     ├───────────────────────►│ 2. POST (JWT + webapp_id) │                           │                           │
     │                        ├──────────────────────────►│                           │                           │
     │                        │   ตรวจสอบสิทธิ์ + สร้าง    │                           │                           │
     │                        │   sso_token (อายุ 5 นาที) │                           │                           │
     │                        │◄── redirect_url?sso_token │                           │                           │
     │ 3. เปิดหน้าเว็บแอปย่อยพร้อม ?sso_token=<raw_token>  │                           │                           │
     ├───────────────────────────────────────────────────────────────────────────────►│                           │
     │                        │                           │                           │ 4. POST /sso/exchange     │
     │                        │                           │                           │    (หรือ /sso/verify)     │
     │                        │                           │                           ├──────────────────────────►│
     │                        │                           │                           │    Mark Token Used (1x)   │
     │                        │                           │                           │◄── user + personnel +     │
     │                        │                           │                           │    app_permission +       │
     │                        │                           │                           │    otp_hash (Mode B)      │
     │                        │                           │                           │                           │
     │                        │                           │                           │ 5. (SPA) supabase.auth    │
     │                        │                           │                           │    .verifyOtp(otp_hash)   │
     │◄───────────────────────┴───────────────────────────┴───────────────────────────┤    → เข้าสู่ระบบทันที!     │
```

### กฎความปลอดภัยของ `sso_token`
- สร้างด้วย Random 32 bytes (64 hex chars) และเก็บเฉพาะค่า **SHA-256 Hash** ในตาราง `security_tokens`
- **ใช้ได้ครั้งเดียว (One-Time Use):** เมื่อถูกแลกผ่าน `/sso/verify` หรือ `/sso/exchange` ระบบจะบันทึก `used_at = now()` ทันที หากนำกลับมาใช้ซ้ำจะคืน `401`
- **อายุสั้น 5 นาที:** หากเกิน `expires_at` จะคืน `401`
- **ผูกกับแอปปลายทาง (`webapp_id`):** Token ที่ออกให้แอป A ไม่สามารถนำไปแลกกับแอป B ได้
- **ควรล้าง Query String `?sso_token=...` ออกจาก Browser URL ทันที** หลังแลกเสร็จ (`navigate('/dashboard', { replace: true })`)

---

## 5. ตาราง API Scopes (7 สิทธิ์) และนโยบายคุ้มครองข้อมูล PDPA

| Scope Code | ชื่อสิทธิ์ | PDPA | Endpoints ที่เปิดสิทธิ์ | ผลต่อข้อมูลที่ส่งออก |
|:--|:--|:--:|:--|:--|
| `permission:read` | อ่านสิทธิ์ผู้ใช้ของแอป | ปกติ | `GET /authorized-users` | ดึงรายชื่อผู้ใช้ที่ได้รับอนุญาตเข้าแอปพร้อม `role_code` และ `hierarchy_level` |
| `reference:read` | อ่านข้อมูลอ้างอิงกลาง | ปกติ | `GET /lookups`, `GET /org-units` | ดึงตัวเลือก Dropdown มาตรฐาน และโครงสร้างหน่วยงาน 4 ระดับ |
| `position:read` | อ่านโครงสร้างตำแหน่ง | ปกติ | `GET /positions` | ดึงประเภทตำแหน่ง ตำแหน่ง ระดับตำแหน่ง และตารางระดับที่อนุญาต |
| `personnel:read` | อ่านข้อมูลบุคลากรพื้นฐาน | ปกติ | `GET /personnel`, `GET /personnel/{id}`, `POST /personnel/batch`, `GET /personnel/approvers` | คืนข้อมูลพื้นฐานบุคลากร สังกัด ตำแหน่ง (`position_display`) — **พรางเลขบัตรเป็น `cid_masked` เสมอ** |
| `personnel:signature` | เข้าถึงลิงก์ลายเซ็น | **PDPA** | ทุก Endpoint ที่คืน `personnel` | แนบ `signature_url` (ลิงก์รูปลายเซ็นบน Google Drive); หากไม่มี Scope นี้จะลบ `signature_path` และส่ง `signature_url: null` |
| `personnel:career` | อ่านประวัติรับราชการ | **PDPA** | ทุก Endpoint ที่คืน `personnel` + ใช้ร่วมกับ `GET /personnel/decoration-source` | เปิดฟิลด์ `start_service_date`, `start_service_year_be`, `initial_position`, `re_appointment_date`, `transfer_in_date`, `prior_continuous_service_days`, `double_service_days` |
| `personnel:sensitive` | อ่านข้อมูลอ่อนไหว (เงินเดือน/วินัย) | **PDPA** | ทุก Endpoint ที่คืน `personnel` + ใช้ร่วมกับ `GET /personnel/decoration-source` | เปิดฟิลด์ `initial_salary`, `current_salary`, `position_allowance`, `is_max_step`, `disciplinary_flag`, `disciplinary_note` |

### นโยบาย PDPA Field Sanitization (`sanitizePersonnelByScopes`)
ทุก Endpoint บุคลากรทั่วไป (`/sso/verify`, `/sso/exchange`, `/me`, `/personnel`, `/personnel/{id}`, `/personnel/batch`, `/personnel/approvers`) จะถูกกรองอัตโนมัติฝั่ง Server เสมอ:
1. **เลขบัตรประชาชน (`cid`):** ลบฟิลด์ `cid` ดิบออกและแทนที่ด้วย `cid_masked` (เช่น `1-xxxx-xxxxx-12-3`) เสมอ *(ยกเว้น `GET /personnel/decoration-source` ที่ต้องถือทั้ง `personnel:career` + `personnel:sensitive` และอ่านตรงจาก `v_decoration_hr_source` จึงคืนทั้ง `cid` และ `cid_masked`)*
2. **ลายเซ็น:** หากไม่มี `personnel:signature` → ลบ `signature_path` และตั้ง `signature_url = null`
3. **เงินเดือน & วินัย:** หากไม่มี `personnel:sensitive` → ลบ `initial_salary`, `current_salary`, `position_allowance`, `is_max_step`, `disciplinary_flag`, `disciplinary_note`
4. **ประวัติรับราชการ:** หากไม่มี `personnel:career` → ลบ `start_service_date`, `start_service_year_be`, `initial_position`, `re_appointment_date`, `transfer_in_date`, `prior_continuous_service_days`, `double_service_days`

---

## 6. เอกสารอ้างอิง API ครบทุก Endpoint (Endpoint Reference)

**Base URL:**
```text
https://<your-project-ref>.supabase.co/functions/v1/portal-api
```

### ตารางสรุป Endpoints ทั้งหมด

| # | Method | Path | Mode | Scope ที่ต้องมี | หน้าที่หลัก |
|:-:|:--|:--|:--|:--|:--|
| 1 | `GET` | `/health` | Public | *(ไม่ต้องมี)* | ตรวจสอบสถานะการทำงานของ `portal-api` |
| 2 | `POST` | `/sso/verify` | **Mode A เท่านั้น** | *(ไม่ต้องมี)* | ตรวจสอบและแลก `ssoToken` สำหรับ Server / GAS |
| 3 | `POST` | `/sso/exchange` | Mode A / **Mode B** | *(ไม่ต้องมี)* | แลก `ssoToken` เป็น `otp_hash` + `user` + `personnel` + `app_permission` สำหรับ SPA |
| 4 | `GET` | `/me` | Mode B (`Bearer JWT`) | *(ไม่ต้องมี)* | ดึงข้อมูลผู้ใช้ปัจจุบัน + บุคลากร + สิทธิ์ในแอป |
| 5 | `GET` | `/app-roles` | Mode A / B | *(ไม่ต้องมี)* | ดึงรายการ Roles ทั้งหมดที่เปิดใช้งานของแอปนี้ |
| 6 | `GET` | `/authorized-users` | Mode A / B (`JWT`) | `permission:read` | ดึงรายชื่อผู้ใช้งานที่ได้รับสิทธิ์เข้าแอปนี้ (กรองตาม `role_code` / `min_hierarchy_level` ได้) |
| 7 | `GET` | `/lookups` | Mode A / B (`JWT`) | `reference:read` | ดึงตัวเลือก Dropdown กลาง (กรอง `?category=PREFIX` ได้) |
| 8 | `GET` | `/org-units` | Mode A / B (`JWT`) | `reference:read` | ดึงโครงสร้างหน่วยงาน 4 ระดับ (เรียงตาม `sort_order`) |
| 9 | `GET` | `/positions` | Mode A / B (`JWT`) | `position:read` | ดึงประเภทตำแหน่ง, ตำแหน่ง, ระดับตำแหน่ง และตารางระดับที่อนุญาต |
| 10 | `GET` | `/personnel` | Mode A / B (`JWT`) | `personnel:read` | ดึงรายชื่อบุคลากรตามขอบเขตสิทธิ์ (สูงสุด 500 รายการต่อครั้ง) |
| 11 | `GET` | `/personnel/{id}` | Mode A / B (`JWT`) | `personnel:read` | ดึงข้อมูลบุคลากรรายบุคคลตาม UUID |
| 12 | `POST` | `/personnel/batch` | Mode A / B (`JWT`) | `personnel:read` | ดึงข้อมูลบุคลากรหลายรายการพร้อมกันตาม array ของ UUID |
| 13 | `GET` | `/personnel/approvers` | Mode A / B (`JWT`) | `personnel:read` | ดึงรายชื่อผู้มีอำนาจลงนาม/ผู้อนุมัติ (กรอง `office_id` / `department_id` ได้) |
| 14 | `GET` | `/personnel/decoration-source` | Mode A / B (`JWT`) | `personnel:career` **+** `personnel:sensitive` | ดึงข้อมูล HR กลางและไทม์ไลน์ JSONB ครบชุดสำหรับระบบเครื่องราชฯ |
| — | `GET` | `/personnel/drivers` | *Deprecated* | — | คืน **`410 Gone`** (ย้ายไปยัง Schema แอปรถราชการแล้วตั้งแต่ Migration `014`) |
| — | `GET` | `/personnel/decoration-profiles` | *Deprecated* | — | คืน **`410 Gone`** (ให้ใช้ `GET /personnel/decoration-source` แทน) |

---

### รายละเอียดแต่ละ Endpoint

#### 1. `GET /health`
ตรวจสอบว่าบริการ `portal-api` พร้อมใช้งานหรือไม่ (ไม่ต้องแนบ Header ยืนยันตัวตน)
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "service": "portal-api",
    "version": "2.4.0",
    "timestamp": "2026-11-25T08:00:00.000Z"
  }
  ```

#### 2. `POST /sso/verify` (Mode A เท่านั้น)
สำหรับ Server Backend หรือ Google Apps Script ตรวจสอบ One-Time `sso_token` ที่ส่งมาจาก Portal SSO
- **Headers:** `x-app-key: <your-app-api-key>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  { "ssoToken": "<raw_token_from_url_query>" }
  ```
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "user": {
      "id": "uuid",
      "username": "1100100123456",
      "email": "user@example.go.th",
      "role": "USER"
    },
    "personnel": {
      "id": "uuid",
      "cid_masked": "1-xxxx-xxxxx-45-6",
      "full_name": "นายสมชาย ใจดี",
      "position_display": "เจ้าพนักงานเทศกิจชำนาญงาน",
      "bureau_name": "สำนักเทศกิจ",
      "office_name": "สำนักงานตรวจและบังคับการ",
      "department_name": "ส่วนตรวจและบังคับการ 1",
      "signature_url": null
    },
    "app_permission": {
      "role_code": "STAFF",
      "role_name_th": "ผู้ใช้งานทั่วไป",
      "hierarchy_level": 10
    }
  }
  ```

#### 3. `POST /sso/exchange` (Mode B — แนะนำสำหรับ SPA)
แลก `sso_token` เป็น `otp_hash` เพื่อให้ Frontend SPA ใช้สร้าง Supabase Auth Session เดียวกับ Portal SSO โดยไม่ต้องให้ผู้ใช้กรอกรหัสผ่านซ้ำ
- **Headers:** `x-app-code: <YOUR_APP_CODE>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  { "ssoToken": "<raw_token_from_url_query>" }
  ```
- **Response (`200 OK`):** เหมือน `/sso/verify` แต่เพิ่มฟิลด์ `"otp_hash": "<magiclink_hashed_token>"` สำหรับส่งเข้า `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`

#### 4. `GET /me`
ดึงข้อมูลตัวตนปัจจุบันของผู้ที่ถือ Bearer JWT พร้อมสิทธิ์ในแอปนี้ (กรณีผู้ใช้เป็น `SUPERADMIN` และยังไม่มีแถวใน `user_app_permissions` ระบบจะคืน Role สูงสุดของแอปให้โดยอัตโนมัติ)
- **Headers:** `x-app-code: <YOUR_APP_CODE>`, `Authorization: Bearer <access_token>`
- **Response (`200 OK`):** `{ success: true, user, personnel, app_permission }`

#### 5. `GET /app-roles`
ดึงรายการ Roles ที่เปิดใช้งาน (`is_active = true`) ของเว็บแอปนี้ เรียงจาก `hierarchy_level` มากไปน้อย
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid",
        "role_code": "APP_ADMIN",
        "role_name_th": "ผู้ดูแลระบบย่อย",
        "description": "จัดการตั้งค่าทั้งหมดในแอป",
        "hierarchy_level": 90,
        "color_hex": "#00744B",
        "is_default_on_grant": false,
        "is_app_admin": true
      }
    ]
  }
  ```

#### 6. `GET /authorized-users` *(Scope: `permission:read`)*
ดึงรายชื่อผู้ใช้งานที่ได้รับสิทธิ์เข้าใช้งานเว็บแอปนี้ (`is_allowed = true`)
- **Query Params (Optional):**
  - `role_code`: กรองเฉพาะ Role เช่น `?role_code=APPROVER`
  - `min_hierarchy_level`: กรองระดับสิทธิ์ขั้นต่ำ เช่น `?min_hierarchy_level=30`
- **Scoped RBAC (Mode B):** `SUPERADMIN` เห็นทั้งหมด · `ADMIN` (Lv2/Lv3) เห็นเฉพาะผู้ใช้ใน `office_id`/`department_id` ของตน · `USER` ทั่วไปเห็นเฉพาะแถวของตนเอง (`user_id = actor.id`) *(Mode A เห็นทั้งหมดของแอปนั้น)*
- **Response (`200 OK`):** `{ success: true, data: [ /* แถวจาก v_user_app_access_matrix */ ] }`

#### 7. `GET /lookups` *(Scope: `reference:read`)*
ดึงหมวดหมู่และรายการ Dropdown มาตรฐาน เรียงตาม `sort_order` ในหน้าตั้งค่าระบบ
- **Query Params (Optional):**
  - `category`: รหัสหมวดหมู่ เช่น `?category=PREFIX`, `GENDER`, `EMPLOYMENT_TYPE`, `PERSONNEL_STATUS`, `APPROVAL_TIER`, `EVAL_GRADE`, `DISCIPLINARY_TYPE`, `DISCIPLINARY_PENALTY`, `DISCIPLINARY_CASE_STATUS`, `SERVICE_INTERRUPTION_TYPE`
- **Response (`200 OK`):** `{ success: true, categories: [...], items: [...] }`

#### 8. `GET /org-units` *(Scope: `reference:read`)*
ดึงโครงสร้างหน่วยงาน 4 ระดับ (`สำนัก` > `สำนักงาน/กอง` > `ส่วน/ฝ่าย` > `กลุ่มงาน`) ที่เปิดใช้งาน เรียงตาม `sort_order`
- **Response (`200 OK`):** `{ success: true, levels: [...], data: [...] }`

#### 9. `GET /positions` *(Scope: `position:read`)*
ดึงโครงสร้างสายงานและตำแหน่งทั้งหมด พร้อมตารางจับคู่ระดับตำแหน่งที่อนุญาต (`allowed_levels`) เรียงตาม `sort_order`
- **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "position_types": [...],
    "positions": [...],
    "position_levels": [...],
    "allowed_levels": [
      { "position_id": "uuid", "position_level_id": "uuid" }
    ]
  }
  ```

#### 10. `GET /personnel` *(Scope: `personnel:read`)*
ดึงรายชื่อบุคลากรจาก `v_personnel_directory` (สูงสุด `500` รายการต่อครั้ง ผ่านตัวกรอง Scoped RBAC และ PDPA Sanitizer)
- **Response (`200 OK`):** `{ success: true, data: [ ... ] }`

#### 11. `GET /personnel/{id}` *(Scope: `personnel:read`)*
ดึงข้อมูลบุคลากรรายบุคคลตาม `personnel.id` (UUID)
- **Response (`200 OK`):** `{ success: true, data: { ... } }` หรือ `404 Not Found` หากไม่พบหรืออยู่นอกขอบเขตสิทธิ์

#### 12. `POST /personnel/batch` *(Scope: `personnel:read`)*
ดึงข้อมูลบุคลากรหลายรายการพร้อมกันใน Request เดียว (เหมาะสำหรับ Map ชื่อผู้ยื่นคำขอ/ผู้อนุมัติในตารางเอกสาร)
- **Request Body:**
  ```json
  { "ids": ["uuid-1", "uuid-2", "uuid-3"] }
  ```
- **Response (`200 OK`):** `{ success: true, data: [ ... ] }`

#### 13. `GET /personnel/approvers` *(Scope: `personnel:read`)*
ดึงรายชื่อผู้มีอำนาจลงนามจาก `v_personnel_approvers` (ผู้ที่ถือ `approval_tier` ที่มี `is_approver = true`)
- **Query Params (Optional):**
  - `office_id`: กรองตาม UUID สำนักงาน/กอง (Lv2)
  - `department_id`: กรองตาม UUID ส่วน/ฝ่าย (Lv3)
- **Response (`200 OK`):** `{ success: true, data: [ ... ] }` *(แนบ `signature_url` อัตโนมัติหากแอปมี Scope `personnel:signature`)*

#### 14. `GET /personnel/decoration-source` *(Scopes: `personnel:career` + `personnel:sensitive`)*
Endpoint สัญญาข้อมูลกลางสำหรับระบบพิจารณาขอพระราชทานเครื่องราชอิสริยาภรณ์ (ดึงตรงจาก View `public.v_decoration_hr_source` โดยไม่ผ่าน `sanitizePersonnelByScopes`)
- **Query Params (Optional):**
  - `office_id`: UUID สำนักงาน/กอง
  - `department_id`: UUID ส่วน/ฝ่าย
  - `person_id`: UUID บุคลากรเฉพาะราย
- **Response (`200 OK`):** คืน `{ success: true, data: [...] }` โดยแต่ละแถวใช้คีย์ **`person_id`** (UUID) พร้อมข้อมูล `cid`, `cid_masked`, `status_code`, `birth_date`, `start_service_date`, `start_service_year_be`, `re_appointment_date`, `transfer_in_date`, `prior_continuous_service_days`, `double_service_days`, เงินเดือน, สถานะวินัย และ Array JSONB ของไทม์ไลน์ครบ 7 ชุดตามชื่อฟิลด์จริงใน View: **`former_names`**, **`position_history`**, **`executive_duties`**, **`salary_history`**, **`recent_evaluations`**, **`disciplinary_records`**, **`service_interruptions`** *(หมายเหตุ: การคำนวณอายุราชการสุทธิและวันเกษียณตามกฎ 1 ต.ค. ดำเนินการที่ฝั่งแอปย่อยโดยใช้ข้อมูลวันเกิด/วันบรรจุ/วันทวีคูณ/วันขาดตอนจาก Contract นี้)*

---

## 7. โครงสร้างข้อมูลที่คืนกลับ (Response Schemas)

### ฟิลด์สำคัญใน `personnel` Object (จาก `v_personnel_directory`)
| ฟิลด์ | ชนิดข้อมูล | เงื่อนไขการส่งออก | คำอธิบาย |
|:--|:--|:--|:--|
| `id` | `uuid` | เสมอ | Primary Key ของบุคลากร (ใช้ผูก FK ในแอปย่อย) |
| `cid_masked` | `string` | เสมอ | เลขบัตรประชาชนพราง PDPA เช่น `1-xxxx-xxxxx-12-3` |
| `full_name` | `string` | เสมอ | ชื่อ-นามสกุลเต็มรวมคำนำหน้า/ยศ |
| `position_name`, `position_level_name`, `position_type_code` | `string \| null` | เสมอ | ข้อมูลตำแหน่งและระดับแยกฟิลด์ |
| `position_display` | `string` | เสมอ | ชื่อตำแหน่งพร้อมแสดงผลตามมาตรฐาน กทม. (เช่น `ผู้อำนวยการสำนักงานตรวจและบังคับการ`, `นิติกรชำนาญการ`) |
| `bureau_id`, `office_id`, `department_id`, `division_id` | `uuid \| null` | เสมอ | รหัสสังกัด 4 ระดับ |
| `bureau_name`, `office_name`, `department_name`, `division_name` | `string \| null` | เสมอ | ชื่อสังกัด 4 ระดับ |
| `position_number` | `string \| null` | เสมอ | เลขที่ตำแหน่ง |
| `secondary_position`, `acting_position` | `string \| null` | เสมอ | สรุปตำแหน่งปฏิบัติราชการแทน / รักษาการในตำแหน่ง |
| `executive_duties` | `jsonb[]` | เสมอ | รายการปฏิบัติราชการแทน/รักษาการฯ ทั้งหมด |
| `status_id`, `status_name`, `status_color`, `allows_account_provision` | `uuid / string / boolean` | เสมอ | สถานะบุคลากร สีป้ายสถานะ และสิทธิ์เข้าใช้งาน *(หมายเหตุ: ฟิลด์ `status_code` มีเฉพาะใน `v_decoration_hr_source` / `/personnel/decoration-source`)* |
| `photo_path` | `string \| null` | เสมอ | ลิงก์รูปโปรไฟล์บน Google Drive |
| `signature_url` | `string \| null` | `personnel:signature` | ลิงก์รูปลายเซ็นบน Google Drive (`null` หากไม่มี Scope) |
| `start_service_date`, `start_service_year_be`, `initial_position` | `date / number / string` | `personnel:career` | ข้อมูลวันบรรจุและตำแหน่งแรกบรรจุ |
| `initial_salary`, `current_salary`, `position_allowance`, `is_max_step`, `disciplinary_flag`, `disciplinary_note` | `number / boolean / string` | `personnel:sensitive` | ข้อมูลเงินเดือนและสถานะทางวินัย |

---

## 8. การใช้งาน Dual SDKs และตัวอย่างโค้ดพร้อมใช้งานจริง

### 8.1 TypeScript / Vite / React SPA (`sdk/portal-sso-sdk.ts` — Mode B)

คัดลอกไฟล์ `sdk/portal-sso-sdk.ts` ไปไว้ที่ `src/lib/portal-sso-sdk.ts` ในโปรเจกต์แอปย่อย แล้วตั้งค่า `.env.local`:

```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
VITE_SUPABASE_SCHEMA=<your_subapp_schema>
VITE_PORTAL_API_URL=https://<your-project-ref>.supabase.co/functions/v1/portal-api
VITE_APP_CODE=<YOUR_APP_CODE>
```

#### ตัวอย่างที่ 1: หน้า `/sso-callback` รับ Token และสร้าง Session อัตโนมัติ
```ts
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PortalSsoClient } from '@/lib/portal-sso-sdk';
import { supabase } from '@/lib/supabaseClient';

const portalClient = new PortalSsoClient({
  portalApiUrl: import.meta.env.VITE_PORTAL_API_URL,
  appCode: import.meta.env.VITE_APP_CODE,
});

export function SsoCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('sso_token');
    if (!token) {
      setError('ไม่พบ SSO Token ในลิงก์');
      return;
    }

    (async () => {
      try {
        const res = await portalClient.exchangeSsoToken(token) as {
          otp_hash?: string;
          app_permission?: { role_code: string; role_name_th: string; hierarchy_level: number };
        };
        if (!res.otp_hash) throw new Error('ไม่สามารถออก Session จาก Portal SSO ได้');

        const { error: otpErr } = await supabase.auth.verifyOtp({
          token_hash: res.otp_hash,
          type: 'magiclink',
        });
        if (otpErr) throw otpErr;

        // ล้าง ?sso_token ออกจาก URL ทันทีหลังล็อกอินสำเร็จ
        navigate('/', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ยืนยันตัวตน SSO ไม่สำเร็จ');
      }
    })();
  }, [params, navigate]);

  if (error) return <div className="p-6 text-rose-600 font-bold">{error}</div>;
  return <div className="p-6 text-emerald-700 font-bold">กำลังยืนยันตัวตนจาก Portal SSO...</div>;
}
```

#### ตัวอย่างที่ 2: เรียก API ดึงข้อมูลผู้ใช้งาน ผู้อนุมัติ และข้อมูล HR โดยแนบ Bearer JWT
```ts
import { PortalSsoClient } from '@/lib/portal-sso-sdk';
import { supabase } from '@/lib/supabaseClient';

export async function createAuthedPortalClient() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('กรุณาเข้าสู่ระบบผ่าน Portal SSO ก่อนใช้งาน');

  return new PortalSsoClient({
    portalApiUrl: import.meta.env.VITE_PORTAL_API_URL,
    appCode: import.meta.env.VITE_APP_CODE,
    accessToken: session.access_token,
  });
}

// ตัวอย่างการใช้งานจริง
export async function loadSubAppBootstrapData(officeId?: string) {
  const client = await createAuthedPortalClient();
  const [me, approvers, orgUnits] = await Promise.all([
    client.getMe(),
    client.getApprovers({ officeId }),
    client.getOrgUnits(),
  ]);
  return { me, approvers, orgUnits };
}
```

---

### 8.2 Backend Server / Node.js / Edge Function (`Mode A: x-app-key`)

```ts
import { PortalSsoClient } from './portal-sso-sdk';

// เก็บ PORTAL_APP_KEY ใน Server Environment Variable เท่านั้น ห้ามส่งไปฝั่ง Browser
const serverPortalClient = new PortalSsoClient({
  portalApiUrl: process.env.PORTAL_API_URL!,
  appKey: process.env.PORTAL_APP_KEY!,
});

// ดึงข้อมูลบุคลากรแบบ Batch เพื่อสร้างเอกสาร PDF ฝั่ง Server
const batchRes = await serverPortalClient.getPersonnelBatch([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
]);
```

---

### 8.3 Google Apps Script (`sdk/PortalSSO.gs` — Mode A)

1. คัดลอกไฟล์ `sdk/PortalSSO.gs` เพิ่มเข้าไปในโปรเจกต์ Google Apps Script ของเว็บแอปย่อย
2. ไปที่ **Project Settings → Script Properties** เพิ่ม 2 ค่า:
   - `PORTAL_API_URL` = `https://<your-project-ref>.supabase.co/functions/v1/portal-api`
   - `PORTAL_APP_KEY` = `<your-app-api-key>`
3. ตัวอย่าง `doGet(e)` รับ `?sso_token=...` จาก Portal SSO:

```javascript
function doGet(e) {
  var ssoToken = e && e.parameter && e.parameter.sso_token ? String(e.parameter.sso_token).trim() : '';
  if (!ssoToken) {
    return HtmlService.createHtmlOutput('<h3>กรุณาเปิดระบบนี้ผ่านหน้า Portal SSO</h3>');
  }

  try {
    // 1. ตรวจสอบ One-Time Token ผ่าน Mode A (x-app-key)
    var auth = PortalSSO.verifySsoToken(ssoToken);

    // 2. เก็บข้อมูลเซสชันไว้ใน CacheService (เช่น 60 นาที)
    var sessionId = Utilities.getUuid();
    CacheService.getScriptCache().put(
      'SSO_SESSION_' + sessionId,
      JSON.stringify({
        user: auth.user,
        personnel: auth.personnel,
        app_permission: auth.app_permission,
      }),
      3600
    );

    // 3. ส่งต่อเข้าหน้าเว็บแอป GAS
    var tpl = HtmlService.createTemplateFromFile('Index');
    tpl.sessionId = sessionId;
    tpl.userName = (auth.personnel && auth.personnel.full_name) || auth.user.username;
    tpl.roleName = (auth.app_permission && auth.app_permission.role_name_th) || 'ผู้ใช้งาน';
    return tpl.evaluate().setTitle('เว็บแอปย่อย (เชื่อมต่อ Portal SSO)');
  } catch (err) {
    return HtmlService.createHtmlOutput('<h3>ไม่สามารถยืนยันตัวตนได้: ' + String(err) + '</h3>');
  }
}

function getApproversForOffice(officeId) {
  return PortalSSO.getApprovers(officeId, null);
}
```

#### ตารางเมธอดที่พร้อมใช้งานใน `sdk/PortalSSO.gs` (v2.4.0)
| เมธอดใน `PortalSSO.gs` | Endpoint ปลายทาง | หมายเหตุ |
|:--|:--|:--|
| `PortalSSO.verifySsoToken(ssoToken)` | `POST /sso/verify` | ยืนยัน One-Time Token (Mode A) |
| `PortalSSO.getAppRoles()` | `GET /app-roles` | ดึงรายการ Roles ของแอป |
| `PortalSSO.getAuthorizedUsers(roleCode)` | `GET /authorized-users` | ต้องมี Scope `permission:read` |
| `PortalSSO.getPersonnelBatch(ids)` | `POST /personnel/batch` | ต้องมี Scope `personnel:read` |
| `PortalSSO.getApprovers(officeId, departmentId)` | `GET /personnel/approvers` | ต้องมี Scope `personnel:read` |
| `PortalSSO.getDecorationSource(officeId, departmentId, personId)` | `GET /personnel/decoration-source` | ต้องมี `personnel:career` + `personnel:sensitive` |

> **หมายเหตุสำหรับ GAS:** เมธอด `getDrivers()` และ `getDecorationProfiles()` ใน `PortalSSO.gs` เป็น `@deprecated` (คืน `410 Gone`) และหากต้องการเรียก `/lookups`, `/org-units`, `/positions`, `/personnel` หรือ `/personnel/{id}` จาก GAS ให้เรียกผ่าน `UrlFetchApp.fetch(apiUrl + '/org-units', { headers: { 'x-app-key': appKey } })` หรือเพิ่ม wrapper เข้าใน `PortalSSO.gs` ได้ทันที

---

## 9. การอ่านข้อมูลแบบ Cross-Schema Direct Read (สำหรับเว็บแอปบน Supabase เดียวกัน)

สำหรับเว็บแอปย่อยที่พัฒนาบน **Supabase โปรเจกต์เดียวกัน** (เช่น `decoration_app`, `car_request_app`, `vehicle_tax_app`):
- **สามารถอ่านข้อมูลแบบ Read-Only ได้โดยตรงผ่าน Supabase Client** โดยระบุ `.schema('public')` เช่น:
  ```ts
  const { data, error } = await supabase
    .schema('public')
    .from('v_decoration_hr_source')
    .select('*')
    .eq('office_id', myOfficeId);
  ```
- **บังคับใช้ Scoped RLS ใน Schema ของแอปย่อยได้ทันที** ด้วยฟังก์ชันกลางของ Portal SSO:
  - `public.fn_current_user_role()` → คืน `'SUPERADMIN' | 'ADMIN' | 'USER'`
  - `public.fn_is_personnel_in_my_scope(p_personnel_id uuid)` → คืน `boolean` (ตรวจ Lv2/Lv3 Admin Scope และเจ้าของข้อมูลอัตโนมัติ)
  - `public.fn_is_org_in_my_scope(p_office_id uuid, p_department_id uuid)` → คืน `boolean`
- **⚠️ กฎเหล็ก:** แอปย่อย **ห้าม** `INSERT / UPDATE / DELETE` ลงตารางใน Schema `public` โดยตรงเด็ดขาด ตารางธุรกรรมเฉพาะทางของแอปย่อยต้องสร้างอยู่ใน Schema ของแอปนั้นและอ้างอิง `REFERENCES public.personnel(id) ON DELETE RESTRICT`

---

## 10. รหัสสถานะ HTTP, การจัดการ Error และข้อควรระวังด้านความปลอดภัย

### ตาราง HTTP Status Codes มาตรฐาน
| HTTP Status | ความหมาย | สาเหตุที่พบบ่อยและวิธีแก้ไข |
|:-:|:--|:--|
| `200 OK` | สำเร็จ | โครงสร้างคืน `{ success: true, ... }` |
| `400 Bad Request` | พารามิเตอร์ไม่ครบ/ไม่ถูกต้อง | ลืมส่ง `ssoToken` ใน body ของ `/sso/verify` หรือ `/sso/exchange` |
| `401 Unauthorized` | ไม่ผ่านการยืนยันตัวตน | `x-app-key` ผิด, `x-app-code` ไม่พบ/ถูกปิดใช้งาน, `Origin` ไม่อยู่ใน `allowed_origins`, `Bearer JWT` หมดอายุ, หรือ `ssoToken` ถูกใช้ไปแล้ว/หมดอายุ (> 5 นาที) |
| `403 Forbidden` | ไม่มีสิทธิ์เข้าถึง | เว็บแอปไม่มี API Scope ที่กำหนด (เช่น `Missing scope personnel:read`), เรียก `/sso/verify` ด้วย Mode B, หรือผู้ใช้ไม่มีสิทธิ์ใช้งานแอปนั้นใน `user_app_permissions` |
| `404 Not Found` | ไม่พบข้อมูลหรือ Route | เรียก URL ผิด หรือขอ `personnel/{id}` ที่ไม่มีอยู่/อยู่นอกขอบเขตสังกัด |
| `410 Gone` | Endpoint ถูกยกเลิกแล้ว | เรียก `/personnel/drivers` หรือ `/personnel/decoration-profiles` (ให้ย้ายไปใช้ Schema แอปย่อยหรือ `/personnel/decoration-source`) |
| `500 Internal Server Error` | ข้อผิดพลาดฝั่ง Server | ตรวจสอบ Edge Function Logs บน Supabase Dashboard |

### Checklist ความปลอดภัยก่อนขึ้น Production
1. **ห้ามนำ `x-app-key` ฝังในโค้ดฝั่ง Browser (`VITE_*`)** — ฝั่ง Browser ต้องใช้ Mode B (`x-app-code` + `Bearer JWT`) เท่านั้น
2. **ตั้งค่า `Allowed Origins` ให้ตรงทุกโดเมน** ทั้ง Production (`https://<app>.pages.dev`) และโดเมนกำหนดเอง ห้ามใส่ `/` ปิดท้าย
3. **เปิดเฉพาะ API Scopes ที่ใช้งานจริง** โดยเฉพาะ Scopes กลุ่ม PDPA (`personnel:signature`, `personnel:career`, `personnel:sensitive`)
4. **ไม่เก็บ `cid` ดิบหรือ `sso_token` ใน `localStorage` หรือ Log** และล้าง `?sso_token=` ออกจาก URL ทันทีหลังแลกสำเร็จ
5. **ตรวจสอบการหมุนเวียน API Key (Key Rotation):** หากสงสัยว่า `x-app-key` รั่วไหล ให้กด Rotate Key ใน `/admin/webapps` ของ Portal SSO ทันที (Key เดิมจะถูกยกเลิกทันทีแบบ Real-time)
