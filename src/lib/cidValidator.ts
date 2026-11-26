const THAI_DIGITS_MAP: Record<string, string> = {
  '๐': '0',
  '๑': '1',
  '๒': '2',
  '๓': '3',
  '๔': '4',
  '๕': '5',
  '๖': '6',
  '๗': '7',
  '๘': '8',
  '๙': '9',
};

export function toArabicDigits(input: string): { value: string; converted: boolean } {
  let converted = false;
  const value = String(input || '').replace(/[๐-๙]/g, (ch) => {
    converted = true;
    return THAI_DIGITS_MAP[ch] ?? ch;
  });
  return { value, converted };
}

export function isScientificNotation(raw: string): boolean {
  return /^\s*\d+(?:\.\d+)?[eE][+-]?\d+\s*$/.test(String(raw || ''));
}

export interface CidValidationResult {
  valid: boolean;
  normalized: string;
  errorCode?: 'REQUIRED' | 'CID_SCIENTIFIC' | 'CID_INVALID_LENGTH' | 'CID_MOD11_FAILED';
  message?: string;
  convertedThaiDigits?: boolean;
}

/**
 * Thai 13-digit National ID (CID) Mod 11 validator:
 * CheckDigit = (11 - (sum(d[i] * (14 - (i+1))) mod 11)) mod 10
 */
export function validateCid(rawInput: string): CidValidationResult {
  const trimmed = String(rawInput || '').trim().replace(/^'+/, '');
  if (!trimmed) {
    return { valid: false, normalized: '', errorCode: 'REQUIRED', message: 'กรุณาระบุเลขประจำตัวประชาชน 13 หลัก' };
  }

  const { value: arabic, converted } = toArabicDigits(trimmed);

  if (isScientificNotation(arabic)) {
    return {
      valid: false,
      normalized: arabic,
      errorCode: 'CID_SCIENTIFIC',
      message: 'พบเลขยกกำลัง (เช่น 3.10E+12) จากการบันทึก CSV ด้วย Excel กรุณาแก้ไขเป็นเลข 13 หลักเต็ม',
      convertedThaiDigits: converted,
    };
  }

  const digits = arabic.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) {
    return {
      valid: false,
      normalized: digits,
      errorCode: 'CID_INVALID_LENGTH',
      message: `เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก (พบ ${digits.length} หลัก)`,
      convertedThaiDigits: converted,
    };
  }

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  if (Number(digits[12]) !== checkDigit) {
    return {
      valid: false,
      normalized: digits,
      errorCode: 'CID_MOD11_FAILED',
      message: `เลขประจำตัวประชาชนไม่ผ่านสูตรตรวจสอบหลักที่ 13 (Mod 11 — หลักสุดท้ายควรเป็น ${checkDigit})`,
      convertedThaiDigits: converted,
    };
  }

  return { valid: true, normalized: digits, convertedThaiDigits: converted };
}

/**
 * PDPA-compliant masked CID (e.g., 1-xxxx-xxxxx-12-3)
 */
export function maskCid(cid: string | null | undefined): string {
  const digits = String(cid || '').replace(/\D/g, '');
  if (digits.length !== 13) return 'x-xxxx-xxxxx-xx-x';
  return `${digits[0]}-xxxx-xxxxx-${digits.slice(10, 12)}-${digits[12]}`;
}

export function formatCidDisplay(cid: string | null | undefined): string {
  const digits = String(cid || '').replace(/\D/g, '');
  if (digits.length !== 13) return String(cid || '');
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`;
}

export function getInitialCredentialFromCid(cid: string): string {
  const digits = String(cid || '').replace(/\D/g, '');
  return digits.slice(-6);
}
