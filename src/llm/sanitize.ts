/**
 * Validation of model output. Models return almost-right JSON often enough
 * that every field is checked and coerced here, never trusted.
 */
import { z } from 'zod';
import type { LabelRead, WebPriceHit } from './types.js';

const str = (max: number) => z.preprocess((v) => (v == null ? '' : String(v)), z.string()).transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, max));

const labelSchema = z.object({
  producer: str(120),
  name: str(160),
  vintage: str(10),
  region: str(80),
  country: str(60),
  grape: str(80),
  colour: str(10),
  bottle_ml: z.preprocess((v) => (v == null || v === '' ? null : Number(v)), z.number().nullable()).catch(null),
  raw_text: str(800),
  confidence: z.preprocess((v) => Number(v), z.number()).catch(0.5),
});

export function sanitizeLabel(raw: unknown): LabelRead | null {
  const r = labelSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  const year = d.vintage.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1];
  const vintage = year ?? (/^n\.?\s?v\.?$|non[\s-]?vintage/i.test(d.vintage) ? 'NV' : '');
  const colour = d.colour.toLowerCase().replace('rosé', 'rose');
  const ml = d.bottle_ml && d.bottle_ml >= 50 && d.bottle_ml <= 30000 ? Math.round(d.bottle_ml) : null;
  if (!d.producer && !d.name && !d.raw_text) return null;
  return {
    producer: d.producer,
    name: d.name,
    vintage,
    region: d.region,
    country: d.country,
    grape: d.grape,
    colour: ['red', 'white', 'rose'].includes(colour) ? colour : '',
    bottleMl: ml,
    rawText: d.raw_text,
    confidence: Math.min(1, Math.max(0, d.confidence)),
  };
}

const hitSchema = z.object({
  merchant: str(120),
  url: str(1000),
  price: z.preprocess((v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')), z.number()),
  currency: str(5).catch('USD'),
  vintage: str(10).catch(''),
  bottle_ml: z.preprocess((v) => (v == null || v === '' ? null : Number(v)), z.number().nullable()).catch(null),
  pack_size: z.preprocess((v) => (v == null || v === '' ? 1 : Number(v)), z.number()).catch(1),
  in_stock: z.preprocess((v) => (typeof v === 'boolean' ? v : null), z.boolean().nullable()).catch(null),
  title: str(300).catch(''),
});

export function sanitizePriceHits(raw: unknown): WebPriceHit[] {
  if (!Array.isArray(raw)) return [];
  const out: WebPriceHit[] = [];
  for (const item of raw) {
    const r = hitSchema.safeParse(item);
    if (!r.success) continue;
    const d = r.data;
    let url: URL;
    try {
      url = new URL(d.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (!(d.price > 1 && d.price < 100000)) continue;
    const pack = Number.isInteger(d.pack_size) && d.pack_size >= 1 && d.pack_size <= 24 ? d.pack_size : 1;
    out.push({
      merchant: d.merchant || url.hostname.replace(/^www\./, ''),
      url: url.toString(),
      priceCents: Math.round(d.price * 100),
      currency: (d.currency || 'USD').toUpperCase(),
      vintage: d.vintage.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1] ?? (/^nv$/i.test(d.vintage) ? 'NV' : ''),
      bottleMl: d.bottle_ml && d.bottle_ml >= 50 && d.bottle_ml <= 30000 ? Math.round(d.bottle_ml) : null,
      packSize: pack,
      inStock: d.in_stock,
      title: d.title,
    });
  }
  return out;
}
