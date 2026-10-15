/**
 * Scan learning: every confirmed scan stores the words OCR read off the label
 * for the wine it turned out to be. OCR garbles a given label in much the same
 * way each time, so a later photo whose words overlap strongly with a stored
 * label is that wine - no LLM call, however garbled the text.
 */
import type { Db } from '../db/pool.js';
import { identityTokens } from '../lib/normalize.js';

/** Too few words can't identify a label. */
const MIN_TOKENS = 3;
/** Share of words (Jaccard) a new photo must have in common with a stored label. */
const MIN_SIMILARITY = 0.6;
/** ...and by how much the best wine must beat the next one. */
const MIN_MARGIN = 0.15;
/** Stored labels kept per wine (newest). */
const KEEP_PER_WINE = 20;

export const labelTokens = (text: string) => identityTokens(text);

export async function learnLabelText(db: Db, wineId: number, ocrText: string, scanId: number | null): Promise<void> {
  const tokens = labelTokens(ocrText);
  if (tokens.length < MIN_TOKENS) return;
  await db.query('INSERT INTO label_texts (wine_id, tokens, scan_id) VALUES ($1, $2, $3)', [wineId, tokens, scanId]);
  await db.query(
    `DELETE FROM label_texts WHERE wine_id = $1 AND label_text_id NOT IN
       (SELECT label_text_id FROM label_texts WHERE wine_id = $1 ORDER BY created_at DESC LIMIT $2)`,
    [wineId, KEEP_PER_WINE]
  );
}

const jaccard = (a: string[], b: Set<string>) => {
  const inter = a.filter((t) => b.has(t)).length;
  return inter / (a.length + b.size - inter);
};

export async function matchLearned(db: Db, ocrText: string): Promise<{ wineId: number; similarity: number } | null> {
  const tokens = labelTokens(ocrText);
  if (tokens.length < MIN_TOKENS) return null;
  const { rows } = await db.query<{ wine_id: number; tokens: string[] }>(
    'SELECT wine_id, tokens FROM label_texts WHERE tokens && $1 ORDER BY created_at DESC LIMIT 500',
    [tokens]
  );
  const best = new Map<number, number>();
  for (const r of rows) best.set(r.wine_id, Math.max(best.get(r.wine_id) ?? 0, jaccard(r.tokens, new Set(tokens))));
  const ranked = [...best].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < MIN_SIMILARITY || first[1] - (second?.[1] ?? 0) < MIN_MARGIN) return null;
  return { wineId: first[0], similarity: first[1] };
}
