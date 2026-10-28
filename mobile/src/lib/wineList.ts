/**
 * A wine list's (or a shelf's) text, read on the phone with Apple Vision,
 * with where each piece is; rows are rebuilt from that, so a wine's name and
 * its price, far apart on the page, end up on one line. The server reads the
 * rows into wines (src/picks/ on the server).
 */
import LabelText, { type TextBox } from '../../modules/label-text';

/** Gaps wider than this (share of the page width) separate columns: " | ". */
const COLUMN_GAP = 0.06;

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
