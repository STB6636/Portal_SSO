import type { ImportCommitMode, ImportSourceFormat } from './database.types';

export type ImportColumnKey =
  | 'cid'
  | 'prefix_id'
  | 'noble_or_rank_title'
  | 'first_name'
  | 'last_name'
  | 'gender_id'
  | 'birth_date'
  | 'phone_number'
  | 'employment_type_id'
  | 'position_type_id'
  | 'position_id'
  | 'position_level_id'
  | 'position_number'
  | 'secondary_position'
  | 'acting_position'
  | 'bureau_id'
  | 'office_id'
  | 'department_id'
  | 'division_id'
  | 'approval_tier_id'
  | 'start_service_date'
  | 'start_service_year_be'
  | 'initial_position'
  | 'initial_salary'
  | 'current_salary'
  | 'status_id'
  | 'email';

export type CellValidationStatus = 'VALID' | 'WARNING' | 'ERROR';
export type RowImportStatus = 'NEW' | 'UPDATE' | 'WARNING' | 'ERROR';

export type CellErrorCode =
  | 'REQUIRED'
  | 'CID_INVALID_LENGTH'
  | 'CID_SCIENTIFIC'
  | 'CID_MOD11_FAILED'
  | 'CID_DUPLICATE_IN_SHEET'
  | 'LOOKUP_NOT_FOUND'
  | 'POSITION_MISMATCH_TYPE'
  | 'LEVEL_NOT_ALLOWED_FOR_POSITION'
  | 'LEVEL_REQUIRED'
  | 'LEVEL_NOT_ALLOWED_WHEN_NOT_REQUIRED'
  | 'PARENT_REQUIRED'
  | 'ORG_PARENT_MISMATCH'
  | 'OUT_OF_ADMIN_SCOPE'
  | 'INVALID_DATE'
  | 'INVALID_PHONE'
  | 'INVALID_EMAIL'
  | 'INVALID_NUMBER'
  | 'INVALID_YEAR_BE'
  | 'INVALID_BOOLEAN'
  | 'AUTO_FIXED_PREFIX_SHORT'
  | 'AUTO_FIXED_PHONE_ZERO'
  | 'AUTO_FIXED_DATE_CE_TO_BE'
  | 'AUTO_FIXED_THAI_DIGITS'
  | 'AUTO_FIXED_SINGLE_BUREAU'
  | 'AUTO_FIXED_SERVICE_YEAR';

export interface CellValidationResult {
  status: CellValidationStatus;
  code?: CellErrorCode;
  message?: string;
  suggestions?: string[];
  autoFillParentName?: string;
  resolvedId?: string | null;
  normalizedValue?: string;
}

export interface ExistingPersonnelSnapshot {
  personnel_id: string;
  cid: string;
  full_name: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  email: string | null;
  position_name: string | null;
  position_level_name: string | null;
  office_name: string | null;
  department_name: string | null;
  current_salary: number | null;
  in_my_scope: boolean;
}

export interface StagingRow {
  rowId: string;
  sheetRowNo: number;
  selected: boolean;
  cells: Record<ImportColumnKey, string>;
  resolved: Partial<Record<ImportColumnKey, string | number | boolean | null>>;
  validations: Partial<Record<ImportColumnKey, CellValidationResult>>;
  rowStatus: RowImportStatus;
  errorCount: number;
  warningCount: number;
  existingSnapshot?: ExistingPersonnelSnapshot | null;
}

export interface ColumnMappingEntry {
  sourceHeader: string;
  sourceIndex: number;
  targetKey: ImportColumnKey | null;
}

export interface ImportBatchCommitResult {
  jobId: string;
  sourceFormat: ImportSourceFormat;
  mode: ImportCommitMode;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  accountsCreated: number;
  errors: Array<{
    sheetRowNo: number;
    cidMasked: string;
    columnKey: string;
    errorCode: string;
    errorMessage: string;
  }>;
}
