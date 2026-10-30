/**
 * Receipts and invoices for bottles bought. A receipt's text (read on the
 * phone, like a wine list's) or its photo is read into wines with the same
 * readers wine lists use (src/picks/), each line matched to the catalog, with
 * how many bottles and the price of one; the person checks the lines, then
 * the bottles go into a cellar carrying what they cost and the receipt they
 * came on. The receipt's photo is kept to look at later.
 */
import { createWine, getWine } from '../catalog/wines.js';
import type { Db } from '../db/pool.js';
import type { ListEntry, LlmProvider } from '../llm/types.js';
import { readListPages, readShelfPhoto, scorePicks, type MatchKind, type PickJev } from '../picks/picks.js';
import { createTasting } from '../tastings/tastings.js';
import { CellarError, cellarForNew, needCellar } from './cellars.js';

export interface ReceiptLine {
  index: number;
  /** The line as printed. */
  text: string;
  producer: string;
  name: string;
  vintage: string;
  /** Bottles bought. */
  qty: number;
  /** The price of one bottle, in cents. */
  unitCents: number | null;
  bottleMl: number | null;
  match: MatchKind;
  wineId: number | null;
  displayName: string;
  region: string;
  style: string;
  imageUrl: string | null;
  /** The market price now (per 750 ml), to compare with what was paid. */
  retailCents: number | null;
}

export interface ReceiptRead {
  merchant: string;
  /** YYYY-MM-DD, when the receipt says. */
  purchasedOn: string | null;
  totalCents: number | null;
  source: string;
  lines: ReceiptLine[];
}

const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/g;
const cents = (whole: string, frac: string) => Number(whole.replace(/,/g, '')) * 100 + Number(frac);

/** Every money amount on a line, in cents, in order. */
export function amounts(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => cents(m[1]!, m[2]!));
}

/**
 * How many bottles a receipt line is for, and the price of one. Lines say
 * "2 x", "2 @ 24.99", "Qty 2", "2 bt" or "x2"; a line with two prices, one
 * qty times the other, gives the unit price; one price with a quantity over
 * one is taken as the line's total (receipts print the extended price).
 */
export function quantityAndUnit(text: string, printedCents: number | null): { qty: number; unitCents: number | null } {
  const t = text.replace(/\b(19|20)\d\d\b/g, ' ');
  const m = t.match(/^\s*(\d{1,3})\s*(?:x|×|@|bt?l?s?\b|btls?\b|ea\b)/i)
    ?? t.match(/\bqty[:.\s]*(\d{1,3})\b/i)
    ?? t.match(/(?:\s|^)(?:x|×)\s?(\d{1,3})\b/i)
    ?? t.match(/\b(\d{1,3})\s*@\s*\$?\d/)
    ?? t.match(/(?:^|\|)\s*(\d{1,3})\s*(?:\||$)/);
  const qty = Math.max(1, Math.min(999, m ? Number(m[1]) : 1));
  const prices = amounts(text);
  if (qty > 1 && prices.length >= 2) {
    for (const unit of prices) if (prices.some((p) => Math.abs(p - unit * qty) <= qty)) return { qty, unitCents: unit };
  }
  const printed = printedCents ?? (prices.length ? prices[prices.length - 1]! : null);
  if (printed === null) return { qty, unitCents: null };
  return { qty, unitCents: qty > 1 && prices.length <= 1 ? Math.round(printed / qty) : printed };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, mo: number, d: number) =>
  y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;

/** The shop (the first line that reads like a name), the date and the total a receipt shows. */
export function receiptFacts(text: string): { merchant: string; purchasedOn: string | null; totalCents: number | null } {
  const rows = text.split('\n').map((r) => r.replace(/\s*\|\s*/g, ' ').trim()).filter(Boolean);
  const merchant = rows.slice(0, 6).find((r) => /[a-z]{3}/i.test(r) && !amounts(r).length && !/receipt|invoice|order|date|tel|phone|www|@|\d{3}[-.\s]\d{4}/i.test(r) && r.length <= 48) ?? '';
  let purchasedOn: string | null = null;
  for (const r of rows) {
    const a = r.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
    const b = r.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    const c = r.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)\b/i);
    const d = r.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d\d)\b/i);
    purchasedOn = a ? iso(+a[1]!, +a[2]!, +a[3]!)
      : b ? iso(b[3]!.length === 2 ? 2000 + +b[3]! : +b[3]!, +b[1]!, +b[2]!)
      : c ? iso(+c[3]!, MONTHS.indexOf(c[1]!.toLowerCase().slice(0, 3)) + 1, +c[2]!)
      : d ? iso(+d[3]!, MONTHS.indexOf(d[2]!.toLowerCase().slice(0, 3)) + 1, +d[1]!)
      : null;
    if (purchasedOn) break;
  }
  // The last "total" that isn't a subtotal, tax or savings line.
  let totalCents: number | null = null;
  for (const r of rows) {
    if (/\btotal\b/i.test(r) && !/sub-?\s?total|tax|saving|discount|items?\b/i.test(r)) {
      const a = amounts(r);
      if (a.length) totalCents = a[a.length - 1]!;
    }
  }
  return { merchant, purchasedOn, totalCents };
}

/** Read a receipt: its text (each page as the phone read it) or, where the phone can't read text, its photo. */
export async function readReceipt(
  db: Db, input: { pages?: string[]; image?: { bytes: Buffer; mimeType: string } }, readers: LlmProvider[], jev: PickJev = {}
): Promise<ReceiptRead> {
  const pages = (input.pages ?? []).filter((p) => p.trim());
  let entries: ListEntry[];
  let source: string;
  if (pages.length) ({ entries, source } = await readListPages(db, pages, readers));
  else if (input.image) ({ entries, source } = await readShelfPhoto(db, input.image.bytes, input.image.mimeType, undefined, readers));
  else throw new CellarError(400, 'pages or a photo required');
  const facts = receiptFacts(pages.join('\n'));
  // Identify only: whether a line suits the person's palate doesn't matter here.
  const { items } = await scorePicks(db, null, entries, { match: jev.match });
  const lines = items
    .sort((a, b) => a.index - b.index)
    .map((x): ReceiptLine => {
      const { qty, unitCents } = quantityAndUnit(x.entry.text, x.entry.bottleCents);
      return {
        index: x.index, text: x.entry.text, producer: x.entry.producer, name: x.entry.name, vintage: x.entry.vintage,
        qty, unitCents, bottleMl: x.entry.bottleMl, match: x.match, wineId: x.wineId, displayName: x.displayName,
        region: x.region, style: x.style, imageUrl: x.imageUrl, retailCents: x.retailCents,
      };
    });
  return { ...facts, source, lines };
}

export interface ReceiptLineInput {
  wineId?: number | null;
  /** For a wine not in the catalog: what the receipt said. */
  producer?: string;
  name?: string;
  colour?: string;
  vintage?: string | null;
  qty: number;
  unitCents?: number | null;
  bottleMl?: number | null;
}

export interface ReceiptInput {
  cellarId?: number | null;
  merchant?: string;
  purchasedOn?: string | null;
  totalCents?: number | null;
  photo?: { bytes: Buffer; contentType: string } | null;
  lines: ReceiptLineInput[];
}

/** File a receipt and put its bottles in the cellar. Returns the receipt and the new entries. */
export async function saveReceipt(db: Db, userId: number, r: ReceiptInput): Promise<{ receiptId: number; cellarId: number; tastingIds: number[] }> {
  const cellarId = await cellarForNew(db, userId, r.cellarId);
  // Wines not in the catalog are added as the receipt names them.
  const wineIds: number[] = [];
  for (const l of r.lines) {
    if (l.wineId) {
      if (!(await getWine(db, l.wineId))) throw new CellarError(404, 'wine not found');
      wineIds.push(l.wineId);
    } else if (l.producer?.trim() || l.name?.trim()) {
      wineIds.push(await createWine(db, { producer: l.producer ?? '', name: l.name ?? '', colour: l.colour, source: 'user' }));
    } else throw new CellarError(400, 'each line needs a wine');
  }
  const { rows: [x] } = await db.query(
    `INSERT INTO receipts (cellar_id, user_id, merchant, purchased_on, total_cents, photo, photo_type)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7) RETURNING receipt_id`,
    [cellarId, userId, r.merchant?.trim() ?? '', r.purchasedOn ?? null, r.totalCents ?? null, r.photo?.bytes ?? null, r.photo?.contentType ?? null]
  );
  const receiptId = Number(x.receipt_id);
  const tastingIds: number[] = [];
  for (const [i, l] of r.lines.entries()) {
    const id = await createTasting(db, userId, {
      wineId: wineIds[i]!, vintage: l.vintage || null, kind: 'cellar', bottles: l.qty, cellarId, receiptId,
      pricePaid: l.unitCents ? l.unitCents / 100 : null, priceContext: 'retail', bottleMl: l.bottleMl ?? 750,
      tastedOn: r.purchasedOn ?? undefined, location: r.merchant?.trim() ? `Bought at ${r.merchant.trim()}` : '',
    });
    if (id) tastingIds.push(id);
  }
  return { receiptId, cellarId, tastingIds };
}

async function receiptCellar(db: Db, userId: number, receiptId: number, what: 'see' | 'edit'): Promise<number> {
  const { rows: [r] } = await db.query('SELECT cellar_id, user_id FROM receipts WHERE receipt_id = $1', [receiptId]);
  if (!r) throw new CellarError(404, 'receipt not found');
  // A receipt whose cellar is gone stays with whoever filed it.
  if (!r.cellar_id) {
    if (Number(r.user_id) !== userId) throw new CellarError(404, 'receipt not found');
    return 0;
  }
  await needCellar(db, userId, Number(r.cellar_id), what);
  return Number(r.cellar_id);
}

const RECEIPT_COLS = `r.receipt_id, r.cellar_id, c.name AS cellar_name, r.merchant, to_char(r.purchased_on, 'YYYY-MM-DD') AS purchased_on,
  r.total_cents, r.photo IS NOT NULL AS has_photo, r.created_at,
  (SELECT COALESCE(SUM(t.bottles), 0)::int FROM tastings t WHERE t.receipt_id = r.receipt_id AND t.kind = 'cellar') AS bottles,
  (SELECT COUNT(*)::int FROM tastings t WHERE t.receipt_id = r.receipt_id) AS lines`;

const receiptRow = (r: Record<string, unknown>) => ({
  receiptId: Number(r.receipt_id), cellarId: r.cellar_id === null ? null : Number(r.cellar_id), cellarName: r.cellar_name as string | null,
  merchant: r.merchant as string, purchasedOn: r.purchased_on as string | null, totalCents: r.total_cents as number | null,
  hasPhoto: r.has_photo as boolean, bottles: r.bottles as number, lines: r.lines as number,
});

/** Receipts filed in the person's cellars, newest purchase first. */
export async function listReceipts(db: Db, userId: number, cellarId?: number) {
  const { rows } = await db.query(
    `SELECT ${RECEIPT_COLS} FROM receipts r LEFT JOIN cellars c USING (cellar_id)
      WHERE (r.cellar_id IN (SELECT cellar_id FROM cellar_members WHERE user_id = $1) OR (r.cellar_id IS NULL AND r.user_id = $1))
        AND ($2::bigint IS NULL OR r.cellar_id = $2)
      ORDER BY COALESCE(r.purchased_on, r.created_at::date) DESC, r.receipt_id DESC`,
    [userId, cellarId ?? null]
  );
  return rows.map(receiptRow);
}

/** A receipt with the bottles it added (those still in a cellar, and those since drunk). */
export async function getReceipt(db: Db, userId: number, receiptId: number) {
  await receiptCellar(db, userId, receiptId, 'see');
  const { rows: [r] } = await db.query(`SELECT ${RECEIPT_COLS} FROM receipts r LEFT JOIN cellars c USING (cellar_id) WHERE r.receipt_id = $1`, [receiptId]);
  const { rows: entries } = await db.query(
    `SELECT t.tasting_id, t.wine_id, w.display_name, w.colour, w.wine_type, t.vintage_key, t.kind, t.bottles, t.price_paid_cents, t.bottle_ml, w.image_url
       FROM tastings t JOIN wines w USING (wine_id) WHERE t.receipt_id = $1 ORDER BY t.tasting_id`,
    [receiptId]
  );
  return { ...receiptRow(r), entries };
}

export async function updateReceipt(db: Db, userId: number, receiptId: number, p: { merchant?: string; purchasedOn?: string | null; totalCents?: number | null }): Promise<void> {
  await receiptCellar(db, userId, receiptId, 'edit');
  await db.query(
    `UPDATE receipts SET merchant = COALESCE($2, merchant),
            purchased_on = CASE WHEN $5 THEN $3::date ELSE purchased_on END,
            total_cents = CASE WHEN $6 THEN $4 ELSE total_cents END
      WHERE receipt_id = $1`,
    [receiptId, p.merchant?.trim() ?? null, p.purchasedOn ?? null, p.totalCents ?? null, p.purchasedOn !== undefined, p.totalCents !== undefined]
  );
}

export async function setReceiptPhoto(db: Db, userId: number, receiptId: number, photo: { bytes: Buffer; contentType: string }): Promise<void> {
  await receiptCellar(db, userId, receiptId, 'edit');
  await db.query('UPDATE receipts SET photo = $2, photo_type = $3 WHERE receipt_id = $1', [receiptId, photo.bytes, photo.contentType]);
}

export async function receiptPhoto(db: Db, userId: number, receiptId: number): Promise<{ bytes: Buffer; contentType: string } | null> {
  await receiptCellar(db, userId, receiptId, 'see');
  const { rows: [r] } = await db.query('SELECT photo, photo_type FROM receipts WHERE receipt_id = $1', [receiptId]);
  return r?.photo ? { bytes: r.photo, contentType: r.photo_type ?? 'image/jpeg' } : null;
}

/** Forget a receipt; the bottles it added stay, without it. */
export async function deleteReceipt(db: Db, userId: number, receiptId: number): Promise<void> {
  await receiptCellar(db, userId, receiptId, 'edit');
  await db.query('DELETE FROM receipts WHERE receipt_id = $1', [receiptId]);
}
