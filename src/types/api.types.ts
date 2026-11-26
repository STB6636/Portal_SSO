export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
}

export interface SchemaHealthReport {
  status: 'OK' | 'WARNING' | 'ERROR';
  schema_name: string;
  checked_at: string;
  tables_expected: number;
  tables_found: number;
  missing_tables: string[];
  rls_disabled_tables: string[];
  views_found: number;
  functions_found: number;
  gas_drive_configured: {
    script_url: boolean;
    image_folder: boolean;
    signature_folder: boolean;
    document_folder: boolean;
    logo_folder?: boolean;
  };
  row_counts?: {
    personnel: number;
    users: number;
    webapps: number;
    org_units: number;
    positions: number;
    lookup_items: number;
  };
}

export interface DashboardStatsResponse {
  total_personnel: number;
  active_personnel: number;
  total_users: number;
  pending_reset_requests: number;
  total_webapps: number;
  /** @deprecated Moved to Fleet sub-app; kept optional for backward compatibility */
  drivers_count?: number;
  approvers_count: number;
  executive_duties_count?: number;
  personnel_by_office: Array<{ name: string; count: number }>;
  personnel_by_position_type: Array<{ name: string; color: string; count: number }>;
  recent_audits: Array<{
    id: string;
    action: string;
    entity_type: string;
    cid_masked: string | null;
    created_at: string;
  }>;
}

export interface GasDriveVerifyResponse {
  success: boolean;
  version?: string;
  folderId?: string;
  folderName?: string;
  folderUrl?: string;
  sharingAccess?: string;
  message: string;
}

export interface GasDriveUploadResponse {
  success: boolean;
  url?: string;
  fileId?: string;
  folderName?: string;
  subFolderName?: string;
  mimeType?: string;
  sizeBytes?: number;
  sharingMode?: 'anyone' | 'inherited' | 'domain' | 'restricted';
  sharingWarning?: string;
  deletedOldFileId?: string;
  message?: string;
}

export interface GasDriveDeleteResponse {
  success: boolean;
  deleted: boolean;
  fileId?: string;
  reason?: string;
  message?: string;
}

export interface GasDriveBase64Response {
  success: boolean;
  fileId?: string;
  mimeType?: string;
  sizeBytes?: number;
  dataUrl?: string;
  message?: string;
}

export interface GasDriveFolderQuotaItem {
  key: 'image' | 'signature' | 'document' | 'logo';
  label: string;
  configured: boolean;
  accessible: boolean;
  folderId: string;
  folderName: string;
  fileCount: number;
  subFolderCount?: number;
  sizeBytes: number;
  truncated: boolean;
  error?: string;
}

export interface GasDriveQuotaResponse {
  success: boolean;
  version?: string;
  totalLimitBytes: number;
  totalUsedBytes: number;
  availableBytes: number;
  isUnlimited: boolean;
  usedPercent: number;
  folders: GasDriveFolderQuotaItem[];
  checkedAt?: string;
  message: string;
}
