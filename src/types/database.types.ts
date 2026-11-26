export type CoreRole = 'SUPERADMIN' | 'ADMIN' | 'USER';
export type AdminScopeLevelNo = 2 | 3;
export type UserAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';
export type WebappStatus = 'ACTIVE' | 'MAINTENANCE' | 'DISABLED';
export type ImportSourceFormat = 'XLSX' | 'CSV' | 'CLIPBOARD';
export type ImportCommitMode = 'INSERT_ONLY' | 'UPSERT';
export type ResetRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LookupCategoryRow {
  id: string;
  code: string;
  name_th: string;
  description: string | null;
  is_system_locked: boolean;
  has_provision_flag: boolean;
  has_approver_flag: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LookupItemRow {
  id: string;
  category_id: string;
  code: string;
  name_th: string;
  short_name: string | null;
  color_hex: string | null;
  rank_order: number;
  is_default: boolean;
  allows_account_provision: boolean;
  is_approver: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrgUnitLevelRow {
  id: string;
  level_no: 1 | 2 | 3 | 4;
  code: string;
  name_th: string;
  updated_at: string;
}

export interface OrgUnitRow {
  id: string;
  level_id: string;
  parent_id: string | null;
  code: string | null;
  name_th: string;
  short_name: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  level_no?: 1 | 2 | 3 | 4;
}

export interface PositionTypeRow {
  id: string;
  code: string;
  name_th: string;
  color_hex: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PositionRow {
  id: string;
  position_type_id: string;
  name_th: string;
  requires_level: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PositionLevelRow {
  id: string;
  code: string;
  name_th: string;
  rank_order: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PositionAllowedLevelRow {
  position_id: string;
  position_level_id: string;
}

export type ExecutiveDutyType = 'DEPUTIZING' | 'ACTING';

export interface PersonnelRow {
  id: string;
  cid: string;
  prefix_id: string | null;
  noble_or_rank_title: string | null;
  first_name: string;
  last_name: string;
  gender_id: string | null;
  birth_date: string | null;
  phone_number: string | null;
  email: string | null;
  photo_path: string | null;
  signature_path: string | null;
  father_full_name?: string | null;
  mother_full_name?: string | null;
  mother_maiden_name?: string | null;
  spouse_full_name?: string | null;
  spouse_maiden_name?: string | null;
  status_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface PersonnelAssignmentRow {
  personnel_id: string;
  employment_type_id: string | null;
  position_type_id: string | null;
  position_id: string | null;
  position_level_id: string | null;
  position_number: string | null;
  secondary_position: string | null;
  acting_position: string | null;
  bureau_id: string | null;
  office_id: string | null;
  department_id: string | null;
  division_id: string | null;
  approval_tier_id: string | null;
  current_position_date: string | null;
  current_level_date: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface PersonnelCareerRecordRow {
  personnel_id: string;
  start_service_date: string | null;
  start_service_year_be: number | null;
  initial_position: string | null;
  initial_position_type_id?: string | null;
  initial_position_id?: string | null;
  initial_position_level_id?: string | null;
  initial_salary: number | null;
  current_salary: number | null;
  disciplinary_flag: boolean;
  disciplinary_note: string | null;
  re_appointment_date?: string | null;
  transfer_in_date?: string | null;
  prior_continuous_service_days?: number;
  double_service_days?: number;
  position_allowance?: number;
  is_max_step?: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface PersonnelNameHistoryRow {
  id: string;
  personnel_id: string;
  old_prefix_id?: string | null;
  old_prefix: string | null;
  old_first_name: string;
  old_last_name: string;
  changed_date: string;
  document_ref: string | null;
  sort_order?: number;
  created_at: string;
}

export interface PersonnelPositionHistoryRow {
  id: string;
  personnel_id: string;
  position_number: string | null;
  position_type_id: string | null;
  position_id: string | null;
  position_level_id: string | null;
  position_title_snapshot: string | null;
  org_unit_id: string | null;
  effective_date: string;
  end_date: string | null;
  base_salary?: number | null;
  position_allowance?: number | null;
  order_reference: string | null;
  sort_order?: number;
  is_latest?: boolean;
  is_initial?: boolean;
  created_at: string;
}

export interface PersonnelExecutiveDutyRow {
  id: string;
  personnel_id: string;
  duty_type: ExecutiveDutyType;
  position_type_id: string | null;
  position_id: string;
  position_level_id: string | null;
  bureau_id: string | null;
  office_id: string | null;
  department_id: string | null;
  division_id: string | null;
  effective_date: string | null;
  end_date: string | null;
  order_reference: string | null;
  sort_order?: number;
  created_at: string;
  updated_at: string;
}

export interface PersonnelSalaryHistoryRow {
  id: string;
  personnel_id: string;
  base_salary: number;
  position_allowance: number;
  is_max_step: boolean;
  effective_date: string;
  order_reference: string | null;
  sort_order?: number;
  created_at: string;
}

export interface PersonnelEvaluationRow {
  id: string;
  personnel_id: string;
  fiscal_year_be: number;
  eval_round: 1 | 2;
  score_percent: number | null;
  eval_grade_id: string;
  note: string | null;
  sort_order?: number;
  created_at: string;
}

export interface PersonnelDisciplinaryRecordRow {
  id: string;
  personnel_id: string;
  record_type_id: string;
  penalty_level_id: string | null;
  case_status_id: string;
  effective_date: string;
  resolved_date: string | null;
  document_ref?: string | null;
  remark: string | null;
  sort_order?: number;
  created_at: string;
  updated_at: string;
}

export interface PersonnelServiceInterruptionRow {
  id: string;
  personnel_id: string;
  interruption_type_id: string;
  start_date: string;
  end_date: string | null;
  deductible_days: number;
  remark: string | null;
  sort_order?: number;
  created_at: string;
}

export interface PersonnelEducationRow {
  id: string;
  personnel_id: string;
  institution_name: string;
  start_period: string | null;
  end_period: string | null;
  degree_title: string;
  major_name: string | null;
  sort_order?: number;
  created_at: string;
}

export interface PersonnelLicenseRow {
  id: string;
  personnel_id: string;
  license_name: string;
  issuing_agency: string | null;
  license_number: string | null;
  effective_date: string | null;
  sort_order?: number;
  created_at: string;
}

export interface PersonnelTrainingRow {
  id: string;
  personnel_id: string;
  course_name: string;
  start_date: string | null;
  end_date: string | null;
  organizer_name: string | null;
  sort_order?: number;
  created_at: string;
}

export interface UserRow {
  id: string;
  personnel_id: string | null;
  username: string;
  email: string | null;
  auth_email: string;
  role: CoreRole;
  status: UserAccountStatus;
  must_change_credential: boolean;
  credential_changed_at: string | null;
  account_source: string;
  approved_by: string | null;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserAdminScopeRow {
  user_id: string;
  scope_level_no: AdminScopeLevelNo;
  org_unit_id: string;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiScopeCatalogRow {
  code: string;
  name_th: string;
  description: string | null;
  is_sensitive: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface WebappRow {
  id: string;
  app_code: string;
  name: string;
  description: string | null;
  url: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  status: WebappStatus;
  auto_grant_on_provision: boolean;
  sort_order: number;
  api_key_prefix: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebappRoleRow {
  id: string;
  webapp_id: string;
  role_code: string;
  role_name_th: string;
  description: string | null;
  hierarchy_level: number;
  color_hex: string | null;
  is_default_on_grant: boolean;
  is_app_admin: boolean;
  allow_scoped_admin_grant: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserAppPermissionRow {
  id: string;
  user_id: string;
  webapp_id: string;
  webapp_role_id: string;
  is_allowed: boolean;
  expires_at: string | null;
  note: string | null;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialResetRequestRow {
  id: string;
  user_id: string;
  personnel_id: string | null;
  reason: string | null;
  status: ResetRequestStatus;
  handled_by: string | null;
  handled_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface SystemSettingRow {
  key: string;
  value: string | null;
  value_type: string;
  group_name: string;
  label_th: string;
  description: string | null;
  is_public: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface ImportJobRow {
  id: string;
  file_name: string;
  source_format: ImportSourceFormat;
  mode: ImportCommitMode;
  total_rows: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  accounts_created: number;
  status: string;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  cid_masked: string | null;
  office_id: string | null;
  department_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}
