/**
 * Normalize Thai/English strings for lookup matching (trim, collapse whitespace, lowercase)
 */
export function normalizeLookupText(input: string | null | undefined): string {
  return String(input || '')
    .normalize('NFC')
    .replace(/\u200B/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Standard Levenshtein edit distance
 */
export function levenshteinDistance(a: string, b: string): number {
  const s = normalizeLookupText(a);
  const t = normalizeLookupText(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = new Array<number>(t.length + 1);
  const curr = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    const sc = s.charCodeAt(i - 1);
    for (let j = 1; j <= t.length; j += 1) {
      const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = curr[j];
  }
  return prev[t.length];
}

export function similarityScore(a: string, b: string): number {
  const s = normalizeLookupText(a);
  const t = normalizeLookupText(b);
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  if (s === t) return 1;
  const maxLen = Math.max(s.length, t.length);
  const dist = levenshteinDistance(s, t);
  let score = 1 - dist / maxLen;
  if (t.includes(s) || s.includes(t)) {
    score = Math.min(1, score + 0.2);
  }
  return score;
}

/**
 * Return Top-N closest candidate labels using Levenshtein similarity
 */
export function findTopSuggestions(
  query: string,
  candidates: string[],
  limit = 3,
  minScore = 0.25
): string[] {
  const q = normalizeLookupText(query);
  if (!q || candidates.length === 0) return [];

  const unique = Array.from(new Set(candidates.filter(Boolean)));
  return unique
    .map((label) => ({ label, score: similarityScore(q, label) }))
    .filter((entry) => entry.score >= minScore)
    .sort((x, y) => y.score - x.score || x.label.localeCompare(y.label, 'th'))
    .slice(0, limit)
    .map((entry) => entry.label);
}
