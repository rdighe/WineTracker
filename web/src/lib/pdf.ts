/**
 * A PDF wine list's text, read in the browser with pdf.js, laid out in rows
 * the way the iPhone app lays out what Apple Vision reads
 * (mobile/src/lib/wineList.ts): a wine's name and its price, far apart on the
 * page, end up on one line.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Box { text: string; x: number; y: number; w: number; h: number }

/** Gaps wider than this (share of the page width) separate columns: " | ". */
const COLUMN_GAP = 0.06;
const VINTAGE = /\b(19[5-9]\d|20[0-4]\d)\b/g;
const PAGES_LOOKED_AT = 40;

export function layoutRows(boxes: Box[]): string[] {
  const sorted = boxes.filter((b) => b.text.trim()).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: Box[][] = [];
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

/**
 * The wine pages of a PDF menu as text: every page with text when they fit in
 * maxPages, else the pages with the most vintages (the wine list, not the
 * food), in order. Pages with no text (a scanned menu) are counted in `scanned`.
 */
export async function readPdfList(file: File, maxPages: number, maxChars: number): Promise<{ pages: string[]; skipped: number; scanned: number; pageCount: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const read: { text: string; vintages: number; at: number }[] = [];
  let scanned = 0;
  const n = Math.min(doc.numPages, PAGES_LOOKED_AT);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: Box[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const [, , , d, e, f] = item.transform as number[];
      const h = Math.abs(item.height || d || 10);
      boxes.push({ text: item.str, x: e! / width, y: (height - f! - h) / height, w: item.width / width, h: h / height });
    }
    const text = layoutRows(boxes).join('\n').slice(0, maxChars);
    if (text.trim().length < 20) scanned++;
    else read.push({ text, vintages: text.match(VINTAGE)?.length ?? 0, at: p });
  }
  const kept = read.length <= maxPages ? read : [...read].sort((a, b) => b.vintages - a.vintages).slice(0, maxPages).sort((a, b) => a.at - b.at);
  return { pages: kept.map((k) => k.text), skipped: read.length - kept.length + Math.max(0, doc.numPages - n), scanned, pageCount: doc.numPages };
}
