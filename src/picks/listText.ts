/**
 * A wine list read by rules alone: the fallback when neither the phone
 * (Apple Intelligence) nor a server model can read it. Works row by row on
 * the text the phone read off the photo:
 *
 *   - prices are the numbers at the end of a row ("18 / 72", "$95"); two
 *     prices are glass and bottle, one is decided by the heading above it
 *   - a short row with no price is a heading ("SPARKLING", "By the glass",
 *     "Pinot Noir"), or the first line of a wine whose price is on the next
 *   - a year is the vintage; a bin number at the start is dropped
 *
 * Producer and name are split at the first comma or dash, which most lists
 * use; the matcher reads the whole line either way.
 */
import type { ListEntry } from '../llm/types.js';

const YEAR = /\b(19[4-9]\d|20[0-4]\d)\b/;
const NV = /\bN\.?V\.?\b/;
const HEADING_WORDS = /\b(sparkling|champagnes?|bubbles|whites?|reds?|ros[eé]s?|orange|skin contact|dessert|sweet|fortified|ports?|sherry|madeira|by the (glass|bottle)|glass(es)?|bottles?|half bottles?|large format|magnums?|coravin|reserve list|cellar)\b/i;
/** No glass costs this much (cents): a lone price this high is a bottle's. */
const GLASS_MAX = 6000;
const SIZE = /\b(half[- ]bottle|magnum|(187|375|500|1500|3000)\s?ml)\b/i;
const NOT_WINE = /\b(cocktails?|beers?|ciders?|spirits?|sake|non[- ]alcoholic|mocktails?|coffee|tea)\b/i;

/** A price as printed: "18", "$18", "18.00", "1,200". Not a year. */
function priceOf(token: string): number | null {
  const t = token.replace(/^\$/, '').replace(/,(\d{3})/g, '$1');
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (/^(19[4-9]\d|20[0-4]\d)$/.test(t)) return null;
  return n >= 4 && n <= 20000 ? Math.round(n * 100) : null;
}

/** Up to two prices at the end of a row, and the text before them. */
function splitPrices(row: string): { text: string; prices: number[] } {
  const tokens = row.split(/\s+|(?=\|)|(?<=\|)/).filter((t) => t && t !== '|');
  const prices: number[] = [];
  while (tokens.length && prices.length < 2) {
    const last = tokens[tokens.length - 1]!;
    if (/^[/|–-]$/.test(last)) {
      tokens.pop();
      continue;
    }
    // "18/72" as one token.
    const pair = last.match(/^\$?([\d.,]+)\/\$?([\d.,]+)$/);
    if (pair && priceOf(pair[1]!) && priceOf(pair[2]!)) {
      tokens.pop();
      prices.unshift(priceOf(pair[1]!)!, priceOf(pair[2]!)!);
      break;
    }
    const p = priceOf(last);
    if (p === null) break;
    tokens.pop();
    prices.unshift(p);
  }
  return { text: tokens.join(' ').replace(/[\s.…·_–-]+$/, '').trim(), prices };
}

function bottleMlOf(text: string): number | null {
  const ml = text.match(/\b(187|375|500|1500|3000)\s?ml\b/i);
  if (ml) return Number(ml[1]);
  if (/\bhalf[- ]bottle\b/i.test(text)) return 375;
  if (/\bmagnum\b/i.test(text)) return 1500;
  return null;
}

export function parseListText(text: string): ListEntry[] {
  const out: ListEntry[] = [];
  let section = '';
  let serving: 'glass' | 'bottle' | null = null;
  let skipping = false;
  let pending = '';
  for (const raw of text.split('\n')) {
    // Two columns of a list on one row: each half on its own.
    for (const part of raw.includes(' | ') && /\d\s*\|.*\d\s*$/.test(raw) ? splitColumns(raw) : [raw]) {
      const row = part.replace(/\s+/g, ' ').trim();
      if (!row) continue;
      const { text: desc, prices } = splitPrices(row);
      const letters = desc.replace(/[^\p{L}]/gu, '');
      if (!prices.length) {
        const words = row.split(' ').length;
        if (words <= 5 && row.length <= 40 && (HEADING_WORDS.test(row) || NOT_WINE.test(row) || (row === row.toUpperCase() && letters.length >= 3))) {
          if (/glass/i.test(row)) serving = 'glass';
          else if (/bottle/i.test(row)) serving = 'bottle';
          skipping = NOT_WINE.test(row);
          section = row;
          pending = '';
        } else {
          pending = row;
        }
        continue;
      }
      if (skipping) continue;
      // A wine on two lines: a short line above (usually the producer), the details and price here.
      const above = pending && pending.split(' ').length <= 6 ? pending : '';
      pending = '';
      const full = above ? `${above}, ${desc}` : desc;
      if (full.replace(/[^\p{L}]/gu, '').length < 3) continue;
      const vintage = full.match(YEAR)?.[1] ?? (NV.test(full) ? 'NV' : '');
      const clean = full.replace(YEAR, ' ').replace(NV, ' ').replace(SIZE, ' ').replace(/^#?\d{1,4}\s+(?=\p{L})/u, '')
        .replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim();
      const [producer, name] = splitProducer(clean);
      let glass: number | null = null;
      let bottle: number | null = null;
      if (prices.length === 2) [glass, bottle] = [Math.min(...prices), Math.max(...prices)];
      // One price: a glass under a "by the glass" heading (or when cheap), but never $60 or more.
      else if ((serving === 'glass' && prices[0]! < GLASS_MAX) || (!serving && prices[0]! < 2500)) glass = prices[0]!;
      else bottle = prices[0]!;
      out.push({
        producer, name, vintage, region: '', country: '', grape: '', colour: '', style: '', section,
        glassCents: glass, bottleCents: bottle, bottleMl: bottleMlOf(full), text: row,
      });
    }
  }
  return out;
}

/**
 * "Wine A  18 | Wine B  22" -> the two halves, split after a price. Cells
 * with no words ("19 | 76": a glass and a bottle column) stay with the wine.
 */
function splitColumns(row: string): string[] {
  const out: string[] = [];
  for (const cell of row.split(' | ')) {
    const words = cell.replace(/[^\p{L}]/gu, '').length >= 3;
    if (out.length && (!words || !/\d\s*$/.test(out[out.length - 1]!))) out[out.length - 1] += ` ${cell}`;
    else out.push(cell);
  }
  return out;
}

function splitProducer(text: string): [string, string] {
  const m = text.match(/^(.+?)(?:,\s+|\s+[–—-]\s+)(.+)$/);
  return m ? [m[1]!.trim(), m[2]!.trim()] : ['', text];
}
