/**
 * Validation of model output. Models return almost-right JSON often enough
 * that every field is checked and coerced here, never trusted.
 */
import { z } from 'zod';
import { MAX_LINEUP } from './prompts.js';
import type { LabelRead, WebPriceHit, WineInfo, MerchantPlaces } from './types.js';

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

/** Labels read from a lineup photo: {"bottles": [...]} (or a bare array); unreadable entries dropped. */
export function sanitizeLabels(raw: unknown): LabelRead[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { bottles?: unknown }).bottles) ? (raw as { bottles: unknown[] }).bottles : null;
  if (!list) return null;
  return list.map(sanitizeLabel).filter((l): l is LabelRead => l !== null).slice(0, MAX_LINEUP);
}

const obj = <T extends z.ZodRawShape>(shape: T) => z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.object(shape));
const list = (maxItems: number, maxLen: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())).transform((a) =>
    [...new Set(a.map((x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, maxLen) : '')).filter(Boolean))].slice(0, maxItems)
  );

const infoSchema = z.object({
  summary: str(800),
  tasting_notes: obj({ appearance: str(300), nose: str(500), palate: str(500), finish: str(300) }),
  descriptors: list(12, 30),
  food_pairings: list(8, 80),
  serving: obj({ temperature: str(40), decant: str(120), drinking_window: str(120) }),
  producer: obj({ history: str(1200), founded: str(20), location: str(120), website: str(200) }),
  vineyard: str(800),
  specs: obj({ grapes: str(200), abv: str(20), aging: str(300), vinification: str(400), soil: str(200), production: str(80) }),
  wine: obj({ colour: str(10), wine_type: str(12), country: str(60), region: str(80), sub_region: str(80), grape: str(80) }),
  sources: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())),
  spec_sheets: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())),
  tasting_sources: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())),
  consensus: str(400),
});

const SOURCE_KINDS = ['producer', 'importer', 'critic', 'retailer', 'other'] as const;

const webUrl = (s: string): string => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
};

export const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

/** A shop's stores and shipping states, with anything malformed dropped. Null when the reply isn't the right shape. */
export function sanitizeMerchantPlaces(raw: unknown): MerchantPlaces | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { stores?: unknown; ships_to?: unknown; sources?: unknown };
  const text = (v: unknown, max: number) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
  const coord = (v: unknown, lim: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && Math.abs(n) <= lim && n !== 0 ? Math.round(n * 1e4) / 1e4 : null;
  };
  const stores: MerchantPlaces['stores'] = [];
  for (const s of Array.isArray(r.stores) ? r.stores : []) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const state = text(o.state, 2).toUpperCase();
    const lat = coord(o.lat, 90);
    const lng = coord(o.lng, 180);
    // A store is only useful with a place: coordinates, or at least a city in a state.
    if (!(lat !== null && lng !== null) && !(text(o.city, 80) && US_STATES.has(state))) continue;
    stores.push({ name: text(o.name, 120), address: text(o.address, 160), city: text(o.city, 80), state: US_STATES.has(state) ? state : '', postal: text(o.postal, 10), lat, lng });
  }
  const shipsTo = [...new Set((Array.isArray(r.ships_to) ? r.ships_to : []).map((x) => text(x, 2).toUpperCase()).filter((x) => US_STATES.has(x)))].sort();
  const sources: MerchantPlaces['sources'] = [];
  for (const s of Array.isArray(r.sources) ? r.sources : []) {
    const o = (s && typeof s === 'object' ? s : {}) as { title?: unknown; url?: unknown };
    const url = webUrl(String(o.url ?? ''));
    if (url) sources.push({ title: text(o.title, 120) || new URL(url).hostname, url });
  }
  return { stores: stores.slice(0, 40), shipsTo, sources: sources.slice(0, 5) };
}

export function sanitizeWineInfo(raw: unknown, grounded: boolean): WineInfo | null {
  const r = infoSchema.safeParse(raw ?? {});
  if (!r.success) return null;
  const d = r.data;
  const colour = d.wine.colour.toLowerCase().replace('rosé', 'rose');
  const type = d.wine.wine_type.toLowerCase();
  const sources: WineInfo['sources'] = [];
  for (const s of d.sources) {
    const o = (s && typeof s === 'object' ? s : {}) as { title?: unknown; url?: unknown };
    const url = webUrl(String(o.url ?? ''));
    if (url && !sources.some((x) => x.url === url)) sources.push({ title: String(o.title ?? '').trim().slice(0, 120) || new URL(url).hostname, url });
  }
  // Links found by a web search only: without one they are recalled, not read.
  const specSheets: WineInfo['specSheets'] = [];
  for (const s of grounded ? d.spec_sheets : []) {
    const o = (s && typeof s === 'object' ? s : {}) as { title?: unknown; url?: unknown };
    const url = webUrl(String(o.url ?? ''));
    if (url && !specSheets.some((x) => x.url === url)) specSheets.push({ title: String(o.title ?? '').trim().slice(0, 120) || 'Spec sheet', url });
  }
  const tastingSources: WineInfo['tastingSources'] = [];
  for (const s of grounded ? d.tasting_sources : []) {
    const o = (s && typeof s === 'object' ? s : {}) as { source?: unknown; url?: unknown; kind?: unknown; notes?: unknown };
    const notes = String(o.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
    const source = String(o.source ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!notes || !source) continue;
    const kind = SOURCE_KINDS.find((k) => k === String(o.kind ?? '').toLowerCase()) ?? 'other';
    tastingSources.push({ source, url: webUrl(String(o.url ?? '')), kind, notes });
  }
  const info: WineInfo = {
    summary: d.summary,
    tastingNotes: d.tasting_notes,
    descriptors: [...new Set(d.descriptors.map((t) => t.toLowerCase()))],
    foodPairings: d.food_pairings,
    serving: { temperature: d.serving.temperature, decant: d.serving.decant, drinkingWindow: d.serving.drinking_window },
    producer: { ...d.producer, website: webUrl(d.producer.website) },
    vineyard: d.vineyard,
    specs: d.specs,
    wine: {
      colour: ['red', 'white', 'rose'].includes(colour) ? colour : '',
      wineType: ['still', 'sparkling', 'fortified', 'dessert'].includes(type) ? type : '',
      country: d.wine.country, region: d.wine.region, subRegion: d.wine.sub_region, grape: d.wine.grape,
    },
    // Without a web search, "sources" are links the model recalls, not pages it read.
    sources: grounded ? sources.slice(0, 8) : [],
    specSheets: specSheets.slice(0, 3),
    tastingSources: tastingSources.slice(0, 6),
    consensus: grounded ? d.consensus : '',
    grounded,
  };
  // A reply with nothing in it is a failed research, not an empty wine.
  const said = [info.summary, ...Object.values(info.tastingNotes), info.producer.history, info.vineyard, ...Object.values(info.specs)].some(Boolean);
  return said ? info : null;
}
