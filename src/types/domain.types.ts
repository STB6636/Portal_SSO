import type {
  AdminScopeLevelNo,
  CoreRole,
  ExecutiveDutyType,
  LookupCategoryRow,
  LookupItemRow,
  OrgUnitLevelRow,
  OrgUnitRow,
  PersonnelAssignmentRow,
  PersonnelCareerRecordRow,
  PersonnelDisciplinaryRecordRow,
  PersonnelEducationRow,
  PersonnelEvaluationRow,
  PersonnelExecutiveDutyRow,
  PersonnelLicenseRow,
  PersonnelNameHistoryRow,
  PersonnelPositionHistoryRow,
  PersonnelRow,
  PersonnelSalaryHistoryRow,
  PersonnelServiceInterruptionRow,
  PersonnelTrainingRow,
  PositionAllowedLevelRow,
  PositionLevelRow,
  PositionRow,
  PositionTypeRow,
  UserAccountStatus,
  WebappRoleRow,
  WebappRow,
} from './database.types';

export interface AdminScopeInfo {
  scope_level_no: AdminScopeLevelNo;
  org_unit_id: string;
  org_unit_name: string;
  parent_office_id?: string | null;
  parent_bureau_id?: string | null;
}

export interface AuthUserProfile {
  id: string;
  personnel_id: string | null;
  username: string;
  email: string | null;
  role: CoreRole;
  status: UserAccountStatus;
  must_change_credential: boolean;
  full_name: string;
  cid_masked?: string | null;
  photo_path?: string | null;
  signature_path?: string | null;
  position_display?: string | null;
  bureau_name?: string | null;
  office_name?: string | null;
  department_name?: string | null;
  division_name?: string | null;
  admin_scope: AdminScopeInfo | null;
}

export interface PublicSystemSettings {
  organization_name: string;
  bureau_name: string;
  system_title: string;
  logo_url: string;
  footer_description: string;
  allow_self_register: boolean;
  import_max_rows: number;
  import_chunk_size: number;
  google_drive_script_url: string;
  google_drive_image_folder_id: string;
  google_drive_signature_folder_id: string;
  google_drive_document_folder_id: string;
  google_drive_logo_folder_id: string;
  announcement_enabled: boolean;
  announcement_mode: 'text' | 'image';
  announcement_title: string;
  announcement_body: string;
  announcement_image_url: string;
  announcement_start_date: string;
  announcement_end_date: string;
  announcement_updated_at: string;
}

export interface MasterDataBundle {
  categories: LookupCategoryRow[];
  items: LookupItemRow[];
  itemsByCategoryCode: Record<string, LookupItemRow[]>;
  orgUnitLevels: OrgUnitLevelRow[];
  orgUnits: OrgUnitRow[];
  positionTypes: PositionTypeRow[];
  positions: PositionRow[];
  positionLevels: PositionLevelRow[];
  positionAllowedLevels: PositionAllowedLevelRow[];
}

export interface PersonnelExecutiveDutyViewItem {
  id: string;
  duty_type: ExecutiveDutyType;
  position_type_id: string | null;
  position_type_code?: string | null;
  position_type_name: string | null;
  position_id: string;
  position_name: string | null;
  position_level_id: string | null;
  position_level_name: string | null;
  duty_display?: string | null;
  bureau_id: string | null;
  bureau_name: string | null;
  office_id: string | null;
  office_name: string | null;
  department_id: string | null;
  department_name: string | null;
  division_id: string | null;
  division_name: string | null;
  effective_date: string | null;
  end_date: string | null;
  order_reference: string | null;
}

export interface PersonnelDirectoryItem {
  id: string;
  cid: string;
  prefix_id: string | null;
  prefix_name: string | null;
  noble_or_rank_title: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  gender_id: string | null;
  gender_name: string | null;
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
  status_name: string | null;
  status_color: string | null;
  allows_account_provision: boolean;
  employment_type_id: string | null;
  employment_type_name: string | null;
  position_type_id: string | null;
  position_type_code?: string | null;
  position_type_name: string | null;
  position_id: string | null;
  position_name: string | null;
  position_level_id: string | null;
  position_level_name: string | null;
  position_display?: string | null;
  position_number: string | null;
  secondary_position: string | null;
  acting_position: string | null;
  bureau_id: string | null;
  bureau_name: string | null;
  office_id: string | null;
  office_name: string | null;
  department_id: string | null;
  department_name: string | null;
  division_id: string | null;
  division_name: string | null;
  org_display?: string | null;
  approval_tier_id: string | null;
  approval_tier_name: string | null;
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
  has_user_account: boolean;
  user_id: string | null;
  user_role: CoreRole | null;
  user_status: UserAccountStatus | null;
  current_position_date?: string | null;
  current_level_date?: string | null;
  re_appointment_date?: string | null;
  transfer_in_date?: string | null;
  prior_continuous_service_days?: number;
  double_service_days?: number;
  position_allowance?: number;
  is_max_step?: boolean;
  executive_duties?: PersonnelExecutiveDutyViewItem[];
}

export interface PersonnelTimelinesBundle {
  nameHistory: PersonnelNameHistoryRow[];
  positionHistory: PersonnelPositionHistoryRow[];
  executiveDuties: PersonnelExecutiveDutyRow[];
  salaryHistory: PersonnelSalaryHistoryRow[];
  evaluations: PersonnelEvaluationRow[];
  disciplinaryRecords: PersonnelDisciplinaryRecordRow[];
  serviceInterruptions: PersonnelServiceInterruptionRow[];
  educations: PersonnelEducationRow[];
  licenses: PersonnelLicenseRow[];
  trainings: PersonnelTrainingRow[];
}

export interface PersonnelBundlePayload {
  personnel: Partial<PersonnelRow> & { cid: string; first_name: string; last_name: string };
  assignment: Partial<PersonnelAssignmentRow>;
  career?: Partial<PersonnelCareerRecordRow>;
  name_history?: Array<Partial<PersonnelNameHistoryRow>>;
  position_history?: Array<Partial<PersonnelPositionHistoryRow>>;
  executive_duties?: Array<Partial<PersonnelExecutiveDutyRow>>;
  salary_history?: Array<Partial<PersonnelSalaryHistoryRow>>;
  evaluations?: Array<Partial<PersonnelEvaluationRow>>;
  disciplinary_records?: Array<Partial<PersonnelDisciplinaryRecordRow>>;
  service_interruptions?: Array<Partial<PersonnelServiceInterruptionRow>>;
  educations?: Array<Partial<PersonnelEducationRow>>;
  licenses?: Array<Partial<PersonnelLicenseRow>>;
  trainings?: Array<Partial<PersonnelTrainingRow>>;
}

export interface MyAppLaunchCard {
  webapp_id: string;
  app_code: string;
  name: string;
  description: string | null;
  url: string;
  icon: string | null;
  icon_url: string | null;
  color: string | null;
  status: WebappRow['status'];
  role_code: string;
  role_name_th: string;
  role_color: string | null;
  hierarchy_level: number;
  expires_at: string | null;
}

export interface WebappWithRoles extends WebappRow {
  roles: WebappRoleRow[];
  scopes: string[];
  allowed_origins: string[];
  authorized_count: number;
}

export interface OrgFilterState {
  bureauId: string;
  officeId: string;
  departmentId: string;
  divisionId: string;
}

export type DriveFileCategory = 'image' | 'signature' | 'document' | 'logo';
