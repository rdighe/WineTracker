/**
 * Tasting-note tags, normalized so "Dark Cherry", "dark  cherry" and
 * "dark cherry!" are one tag and user text can't carry markup (ported from
 * Wine Circle's wineTags.js).
 */
export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS = 12;

export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-'&]+|[-'&]+$/g, '')
    .trim();
  return t.length >= 2 && t.length <= MAX_TAG_LENGTH ? t : null;
}

export function normalizeTags(list: unknown, max = MAX_TAGS): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    const t = normalizeTag(raw);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
