/**
 * Reading a restaurant wine list (or a store shelf's tags) on the phone. Apple Vision reads the photo's
 * text with where each piece is; rows are rebuilt from that (a wine's name
 * and its price, far apart on the page, end up on one line). Then Apple
 * Intelligence turns the text into wines, a part at a time, whenever the
 * phone has it. Whatever it couldn't read goes to the server as text, which
 * reads it with a model or by rules (src/picks/ on the server).
 */
import LabelText, { type TextBox } from '../../modules/label-text';
import WineList, { type DeviceListWine } from '../../modules/wine-list';
import type { ListEntry } from './types';

/** Gaps wider than this (share of the page width) separate columns: " | ". */
const COLUMN_GAP = 0.06;
/** One part for the on-device model: about this many lines or characters. */
const PART_LINES = 28;
const PART_CHARS = 1600;
/** On-device reading stops after this long; the rest goes to the server. */
const DEVICE_BUDGET_MS = 75_000;

/** Pieces of text grouped into rows, top to bottom, left to right. */
export function layoutRows(boxes: TextBox[]): string[] {
  const sorted = [...boxes].filter((b) => b.text.trim()).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: TextBox[][] = [];
  for (const b of sorted) {
    const mid = b.y + b.h / 2;
    const row = rows[rows.length - 1];
    const rowMid = row ? row.reduce((s, x) => s + x.y + x.h / 2, 0) / row.length : -1;
    const rowH = row ? row.reduce((s, x) => s + x.h, 0) / row.length : 0;
    if (row && Math.abs(mid - rowMid) < Math.max(rowH, b.h) * 0.55) row.push(b);
    else rows.push([b]);
  }
  return rows.map((row) => {
    const parts = row.sort((a, b) => a.x - b.x);
    let line = parts[0]!.text.trim();
    for (let i = 1; i < parts.length; i++) {
      const gap = parts[i]!.x - (parts[i - 1]!.x + parts[i - 1]!.w);
      line += (gap > COLUMN_GAP ? ' | ' : ' ') + parts[i]!.text.trim();
    }
    return line;
  });
}

/** The photo's text as rows, or null where the phone can't read text (Expo Go, web, Android). */
export async function readListPhoto(uri: string): Promise<string[] | null> {
  if (!LabelText) return null;
  try {
    return layoutRows(await LabelText.recognizeTextLayoutAsync(uri));
  } catch {
    return null;
  }
}

let available: Promise<boolean> | null = null;

/** Whether this phone reads lists itself (Apple Intelligence). Asked once per launch. */
export function canReadListsOnDevice(): Promise<boolean> {
  if (!WineList) return Promise.resolve(false);
  available ??= WineList.isAvailableAsync().catch(() => false);
  return available;
}

const HEADING = /^[^\d$]{3,40}$/;

/** Rows in parts the on-device model can take, each with the heading in force where it starts. */
function parts(rows: string[]): { text: string; heading: string }[] {
  const out: { text: string; heading: string }[] = [];
  let cur: string[] = [];
  let heading = '';
  let startHeading = '';
  for (const r of rows) {
    if (cur.length >= PART_LINES || (cur.length && cur.join('\n').length + r.length > PART_CHARS)) {
      out.push({ text: cur.join('\n'), heading: startHeading });
      cur = [];
      startHeading = heading;
    }
    cur.push(r);
    // A short line with no numbers that isn't followed by a price on the same row: likely a heading.
    if (HEADING.test(r) && r.split(' ').length <= 5) heading = r;
  }
  if (cur.length) out.push({ text: cur.join('\n'), heading: startHeading });
  return out;
}

const cents = (dollars: number) => (dollars >= 1 && dollars <= 100000 ? Math.round(dollars * 100) : null);
const COLOURS = new Set(['red', 'white', 'rose', 'orange']);
const STYLES = new Set(['still', 'sparkling', 'sweet', 'fortified']);

function toEntry(w: DeviceListWine): ListEntry | null {
  const producer = String(w.producer ?? '').trim().slice(0, 120);
  const name = String(w.name ?? '').trim().slice(0, 160);
  if (!producer && !name) return null;
  const vintage = String(w.vintage ?? '').trim().toUpperCase();
  const ml = Math.round(Number(w.bottleMl) || 0);
  return {
    producer,
    name,
    vintage: /^(1[89]\d\d|20\d\d|NV)$/.test(vintage) ? vintage : '',
    region: String(w.region ?? '').trim().slice(0, 80),
    country: '',
    grape: String(w.grape ?? '').trim().slice(0, 80),
    colour: COLOURS.has(w.colour) ? w.colour : '',
    style: STYLES.has(w.style) ? w.style : '',
    section: String(w.section ?? '').trim().slice(0, 60),
    glassCents: cents(Number(w.glassPrice) || 0),
    bottleCents: cents(Number(w.bottlePrice) || 0),
    bottleMl: ml >= 50 && ml <= 30000 && ml !== 750 ? ml : null,
    text: [producer, name, vintage].filter(Boolean).join(' ').slice(0, 300),
  };
}

/**
 * The wines in the list's rows, read on the phone as far as it can (part by
 * part, `onProgress(done, total)`); `rest` is the text of the parts it
 * couldn't read, for the server. Mode 'shelf': the rows are a shelf photo's
 * text, and the wines are read from its shelf tags.
 */
export async function readListOnDevice(
  rows: string[], onProgress?: (done: number, total: number) => void, mode: 'list' | 'shelf' = 'list'
): Promise<{ entries: ListEntry[]; rest: string }> {
  const all = parts(rows);
  if (!WineList || !(await canReadListsOnDevice())) return { entries: [], rest: rows.join('\n') };
  const entries: ListEntry[] = [];
  const left: string[] = [];
  const started = Date.now();
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    if (Date.now() - started > DEVICE_BUDGET_MS) {
      left.push(p.text);
      continue;
    }
    try {
      const read = await WineList.readAsync(p.text, mode === 'list' ? p.heading : '', mode);
      entries.push(...read.map(toEntry).filter((e): e is ListEntry => e !== null));
    } catch {
      // Declined by the model's guardrails, too long, or the model is busy: the server reads this part.
      left.push(p.heading ? `${p.heading}\n${p.text}` : p.text);
    }
    onProgress?.(i + 1, all.length);
  }
  return { entries, rest: left.join('\n') };
}
