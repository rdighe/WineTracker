/**
 * How many label scans could skip the LLM? For each photo in a folder: free
 * OCR (PaddleOCR, on CPU) -> label-text matcher, compared with the current
 * pipeline (LLM read -> matcher). Reports scans the free path resolves and
 * any where it picked a different wine than the LLM path.
 *
 *   ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm i --no-save @gutenye/ocr-node sharp
 *   tsx scripts/measure-ocr.ts path/to/label-photos
 *
 * The LLM read is taken from an earlier scan of the same file when there is
 * one, so re-runs don't call the LLM again.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool } from '../src/db/pool.js';
import { createProvider } from '../src/llm/index.js';
import { matchLabelText } from '../src/match/text-match.js';
import { matchLabel } from '../src/scan/scan.js';

// Optional tools, not project dependencies (see the install line above).
const load = (name: string): Promise<any> => import(name);
const Ocr = (await load('@gutenye/ocr-node')).default;
const sharp = (await load('sharp')).default;

const dir = process.argv[2];
if (!dir) throw new Error('usage: tsx scripts/measure-ocr.ts <folder of label photos>');
const db = createPool();
const ocr = await Ocr.create();
const llm = createProvider();
const work = mkdtempSync(join(tmpdir(), 'ocr-'));
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort();
let free = 0, agree = 0, disagree = 0, refAuto = 0, geminiCalls = 0;
for (const f of files) {
  const buf = readFileSync(`${dir}/${f}`);
  const tmp = join(work, 'in.png');
  writeFileSync(tmp, await sharp(buf).rotate().resize({ width: 1280, height: 1280, fit: 'inside' }).png().toBuffer());
  const t0 = Date.now();
  const res: any = await ocr.detect(tmp);
  const lines: any[] = Array.isArray(res) ? res : (res.texts ?? []);
  const text = lines.filter((l) => (l.mean ?? 1) >= 0.6).map((l) => l.text).join(' ');
  const ocrMs = Date.now() - t0;
  const tm = await matchLabelText(db, text);

  // Reference: the Gemini read stored by an earlier scan of this exact file, else a live read.
  const sha = createHash('sha256').update(buf).digest('hex');
  const cached = await db.query(`SELECT extracted FROM scans WHERE image_sha256 = $1 AND provider <> 'none' ORDER BY scan_id DESC LIMIT 1`, [sha]);
  let read = cached.rows[0]?.extracted;
  if (!read) {
    const mime = /png$/i.test(f) ? 'image/png' : /webp$/i.test(f) ? 'image/webp' : 'image/jpeg';
    read = await llm.readLabel(buf, mime);
    geminiCalls++;
  }
  const ref = await matchLabel(db, read);
  const refWine = ref.outcome === 'auto' ? ref.candidates[0]!.wine : null;
  if (refWine) refAuto++;
  let verdict = 'needs Gemini';
  if (tm.outcome === 'auto') {
    free++;
    if (!refWine) verdict = 'FREE (Gemini path unsure)';
    else if (tm.wine!.wine_id === refWine.wine_id) { agree++; verdict = 'FREE, same wine'; }
    else { disagree++; verdict = `FREE, DIFFERENT wine (Gemini: ${refWine.display_name})`; }
  }
  console.log(`${f}\n  OCR (${ocrMs} ms): ${text}\n  free path: ${tm.outcome}${tm.wine ? ` -> ${tm.wine.display_name}` : ''}, vintage ${tm.vintage ?? '?'}\n  Gemini path: ${ref.outcome} -> ${ref.candidates[0]?.wine.display_name ?? '-'}, vintage ${read.vintage || '?'}\n  => ${verdict}`);
}
console.log(`\n${files.length} photos: free path resolved ${free} (${agree} same as Gemini, ${disagree} different); Gemini path auto-matched ${refAuto}; live LLM calls made: ${geminiCalls}`);
await db.end();
