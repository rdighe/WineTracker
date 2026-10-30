/**
 * The catalog wine an imported row is (Vivino, CellarTracker): the matcher's
 * confident match, else the person's own new wine (one per name, however
 * many rows name it), never a guess at the wrong one.
 */
import { createWine } from '../catalog/wines.js';
import type { Db } from '../db/pool.js';
import { normalize } from '../lib/normalize.js';
import { matchWine } from '../match/matcher.js';

export interface ImportedWine { producer: string; name: string; region?: string; country?: string; colour?: string; grape?: string; wineType?: string }

export class WineResolver {
  matched = 0;
  added = 0;
  addedNames: string[] = [];
  private created = new Map<string, number>();
  constructor(private db: Db) {}

  async resolve(w: ImportedWine): Promise<number> {
    const text = [w.producer, w.name, w.region].filter(Boolean).join(' ');
    const match = await matchWine(this.db, { text, producer: w.producer || undefined, name: w.name || undefined, colour: w.colour || undefined });
    if (match.outcome === 'auto') {
      this.matched++;
      return match.candidates[0]!.wine.wine_id;
    }
    const k = normalize(`${w.producer} ${w.name}`);
    const existing = this.created.get(k);
    if (existing) return existing;
    const wineId = await createWine(this.db, {
      producer: w.producer || w.name, name: w.producer ? w.name : '', region: w.region, country: w.country, colour: w.colour, grape: w.grape,
      wine_type: w.wineType, source: 'user',
    });
    this.created.set(k, wineId);
    this.added++;
    if (this.addedNames.length < 20) this.addedNames.push([w.producer, w.name].filter(Boolean).join(' '));
    return wineId;
  }
}
