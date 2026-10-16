/**
 * Label scan: photo -> vision model reads the label -> catalog matcher.
 *
 * Outcome follows the matcher: 'auto' (confident), 'choose' (show top
 * candidates), 'new' (offer to create the wine). Confirming a scan teaches
 * the matcher an alias, so the next photo of that label matches directly.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { addAlias, createWine, getWine, type NewWine } from '../catalog/wines.js';
import { matchWine, type MatchResult } from '../match/matcher.js';
import type { LabelRead, LlmProvider } from '../llm/types.js';
import { normalize } from '../lib/normalize.js';
import { matchLabelText } from '../match/text-match.js';
import { learnLabelText, matchLearned } from './learned.js';

export const MAX_CANDIDATES_SHOWN = 5;

export interface ScanResult {
  scanId: number;
  read: LabelRead;
  outcome: MatchResult['outcome'];
  vintage: string | null;
  bottleMl: number | null;
  candidates: Array<{ wineId: number; displayName: string; region: string; country: string; score: number }>;
  /** How the label was read: 'ocr', 'ocr-learned', 'ocr-fuzzy' (phone text, no LLM) or the LLM provider's name. */
  source: string;
}

/** Match on the structured fields first; fall back to including all label text. */
export async function matchLabel(db: Db, read: LabelRead): Promise<MatchResult> {
  const fields = [read.producer, read.name, read.region, read.grape].filter(Boolean).join(' ');
  const primary = await matchWine(db, { text: fields, producer: read.producer || undefined, name: read.name || undefined, colour: read.colour || undefined });
  if (primary.outcome === 'auto' || !read.rawText) return primary;
  const withRaw = await matchWine(db, { text: `${fields} ${read.rawText}`, producer: read.producer || undefined, colour: read.colour || undefined });
  return (withRaw.candidates[0]?.score ?? 0) > (primary.candidates[0]?.score ?? 0) ? withRaw : primary;
}

/** Earlier reads of the exact same photo are reused for this long (retries, re-uploads). */
const READ_CACHE_DAYS = 30;
/** Label text from the phone's OCR is capped at this many characters. */
export const MAX_OCR_TEXT = 4000;

/**
 * Identify the wine from the phone's OCR text alone, without the LLM: every
 * identity word printed on the label, else a label learned from earlier
 * confirmed scans, else garbled words corroborated by the appellation.
 */
async function freeMatch(db: Db, ocrText: string): Promise<{ wineId: number; vintage: string | null; via: string } | null> {
  const text = await matchLabelText(db, ocrText);
  if (text.outcome === 'auto' && text.via === 'exact') return { wineId: text.wine!.wine_id, vintage: text.vintage, via: 'ocr' };
  const learned = await matchLearned(db, ocrText);
  // A learned label must not contradict what is printed: if words on the label fit other wines, the learned one must be among them.
  if (learned && (!text.fits.length || text.fits.some((f) => f.wine_id === learned.wineId))) {
    return { wineId: learned.wineId, vintage: text.vintage, via: 'ocr-learned' };
  }
  if (text.outcome === 'auto') return { wineId: text.wine!.wine_id, vintage: text.vintage, via: 'ocr-fuzzy' };
  return null;
}

export async function scanLabel(
  db: Db,
  provider: LlmProvider,
  image: Buffer,
  mimeType: string,
  opts: { ocrText?: string } = {}
): Promise<ScanResult> {
  const sha256 = createHash('sha256').update(image).digest('hex');
  const ocrText = opts.ocrText?.trim().slice(0, MAX_OCR_TEXT) || null;
  const save = async (read: LabelRead, outcome: MatchResult['outcome'], candidates: ScanResult['candidates'], source: string) => {
    const { rows } = await db.query(
      `INSERT INTO scans (image_sha256, extracted, candidates, outcome, chosen_wine_id, provider, ocr_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING scan_id`,
      [sha256, JSON.stringify(read), JSON.stringify(candidates), outcome, outcome === 'auto' ? candidates[0]!.wineId : null, source, ocrText]
    );
    return { scanId: rows[0].scan_id as number, read, outcome, vintage: read.vintage || null, bottleMl: read.bottleMl, candidates: outcome === 'new' ? [] : candidates, source };
  };

  const cached = await db.query(
    `SELECT extracted FROM scans
      WHERE image_sha256 = $1 AND provider = $2 AND created_at > NOW() - make_interval(days => $3)
      ORDER BY created_at DESC LIMIT 1`,
    [sha256, provider.name, READ_CACHE_DAYS]
  );
  if (!cached.rows[0] && ocrText) {
    const free = await freeMatch(db, ocrText);
    const wine = free && (await getWine(db, free.wineId));
    if (free && wine) {
      const read: LabelRead = {
        producer: wine.producer, name: wine.name, vintage: free.vintage ?? '', region: wine.sub_region || wine.region,
        country: wine.country, grape: wine.grape, colour: wine.colour, bottleMl: null, rawText: ocrText, confidence: 0.9,
      };
      const candidates = [{ wineId: wine.wine_id, displayName: wine.display_name, region: wine.region, country: wine.country, score: 1 }];
      return save(read, 'auto', candidates, free.via);
    }
  }

  // Matching always re-runs: it is free and picks up aliases learned since.
  const read: LabelRead = cached.rows[0]?.extracted ?? (await provider.readLabel(image, mimeType));
  const match = await matchLabel(db, read);
  // A label the model itself is unsure about is never auto-attached.
  const outcome = match.outcome === 'auto' && read.confidence < 0.6 ? 'choose' : match.outcome;
  const candidates = match.candidates.slice(0, MAX_CANDIDATES_SHOWN).map((c) => ({
    wineId: c.wine.wine_id,
    displayName: c.wine.display_name,
    region: c.wine.region,
    country: c.wine.country,
    score: Math.round(c.score * 1000) / 1000,
  }));
  return save(read, outcome, candidates, provider.name);
}

export class ScanError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * The user picked a wine (or described a new one) for a scan. Returns the
 * wine id. Picking anything other than the auto match records the label text
 * as an alias for that wine.
 */
export async function confirmScan(
  db: Db,
  scanId: number,
  choice: { wineId: number } | { newWine: Omit<NewWine, 'source'> }
): Promise<number> {
  const { rows } = await db.query('SELECT * FROM scans WHERE scan_id = $1', [scanId]);
  const scan = rows[0];
  if (!scan) throw new ScanError('scan not found', 404);
  const read = scan.extracted as LabelRead;

  let wineId: number;
  if ('wineId' in choice) {
    if (!(await getWine(db, choice.wineId))) throw new ScanError('wine not found', 404);
    wineId = choice.wineId;
  } else {
    if (!choice.newWine.producer?.trim() && !choice.newWine.name?.trim()) throw new ScanError('producer or name required');
    wineId = await createWine(db, { ...choice.newWine, source: 'user' });
  }

  const labelText = [read.producer, read.name].filter(Boolean).join(' ');
  const wasAutoPick = scan.outcome === 'auto' && scan.chosen_wine_id === wineId;
  if (labelText && !wasAutoPick && normalize(labelText)) await addAlias(db, wineId, labelText, 'scan_confirm');

  await db.query('UPDATE scans SET chosen_wine_id = $1, confirmed_at = NOW() WHERE scan_id = $2', [wineId, scanId]);
  // Scan learning: remember what this label's text looks like for this wine.
  if (scan.ocr_text && !scan.confirmed_at) await learnLabelText(db, wineId, scan.ocr_text, scanId);
  return wineId;
}
