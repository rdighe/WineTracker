/**
 * Flavors in what the person wrote about a wine, read on the phone by Apple
 * Intelligence (modules/note-flavors) so their notes count in For you by
 * what they mean, not just by keywords. Where the phone can't (Expo Go,
 * Android, web, an iPhone without Apple Intelligence), the server reads
 * them with an OpenRouter free model instead.
 */
import NoteFlavors from '../../modules/note-flavors';

/** The families the server accepts (src/recs/flavors.ts). */
const FAMILIES = new Set([
  'black_fruit', 'red_fruit', 'citrus', 'orchard', 'stone_fruit', 'tropical', 'floral', 'herbal', 'earthy', 'mineral',
  'oak', 'spice', 'savory', 'rich_sweet', 'yeasty', 'tannic', 'fresh', 'full', 'light', 'sweet',
]);

let available: Promise<boolean> | null = null;

/** Whether this phone reads notes itself. Asked once per launch. */
export function canReadNotesOnDevice(): Promise<boolean> {
  if (!NoteFlavors) return Promise.resolve(false);
  available ??= NoteFlavors.isAvailableAsync().catch(() => false);
  return available;
}

/** What gets read: the tags, then the note (as the server words it). '' when there's nothing. */
export function noteText(notes?: string | null, tags?: string[] | null): string {
  const t = (tags ?? []).map((s) => s.trim()).filter(Boolean);
  return [t.length ? `Tags: ${t.join(', ')}` : '', (notes ?? '').trim()].filter(Boolean).join('\n');
}

/** Family -> intensity 1-3, or null when the phone can't read it (the server will). */
export async function readNoteFlavorsOnDevice(text: string): Promise<Record<string, number> | null> {
  if (!text || !NoteFlavors || !(await canReadNotesOnDevice())) return null;
  try {
    const raw = await NoteFlavors.readAsync(text);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Math.round(Number(v));
      if (FAMILIES.has(k) && n >= 1) out[k] = Math.min(n, 3);
    }
    return out;
  } catch {
    // Declined by the model's guardrails, an unsupported language, or the model is busy: the server reads it.
    return null;
  }
}
