import type {
  MasterDataBundle,
  PersonnelDirectoryItem,
  PersonnelTimelinesBundle,
  PublicSystemSettings,
} from '@/types/domain.types';

export interface Kp7DataBundle {
  person: PersonnelDirectoryItem;
  timelines: PersonnelTimelinesBundle;
  master: MasterDataBundle;
}

export interface Kp7Item1NameFields {
  prefixDisplay: string;
  firstNameDisplay: string;
  lastNameDisplay: string;
}

export interface Kp7RenderOptions {
  useThaiNumerals: boolean;
  includeOwnerSignature: boolean;
  /** C3-A: default false (show blank ruled Item 14 table when positionHistory is empty) */
  allowCurrentPositionFallback?: boolean;
  ministryName: string;
  departmentName: string;
  certifierName: string;
  certifierPosition: string;
  certifyDateIso: string;
  ownerSignDateIso?: string;
  /** Optional settings passed so Canvas renderer can fetch signature via GAS getBase64 (zero-CORS) */
  settings?: PublicSystemSettings;
}

export interface Kp7CareerTableRow {
  effectiveDateIso: string;
  dateLabel: string;
  positionLabel: string;
  positionLines: string[];
  positionNumber: string;
  positionTypeLabel: string;
  positionLevelLabel: string;
  levelLines: string[];
  salaryLabel: string;
  allowanceLabel: string;
  orderRef: string;
  orderRefLines: string[];
}

export interface Kp7VisualCareerLine {
  dateLabel: string;
  positionLine: string;
  positionNumber: string;
  positionTypeLabel: string;
  levelLine: string;
  salaryLabel: string;
  allowanceLabel: string;
  orderRefLine: string;
  isEntryStart: boolean;
}
