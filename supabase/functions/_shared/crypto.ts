export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateRandomToken(byteLength = 32): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function maskCid(cid: string | null | undefined): string {
  const d = String(cid || '').replace(/\D/g, '');
  if (d.length !== 13) return 'x-xxxx-xxxxx-xx-x';
  return `${d[0]}-xxxx-xxxxx-${d.slice(10, 12)}-${d[12]}`;
}
