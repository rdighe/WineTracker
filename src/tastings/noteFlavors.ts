/**
 * Flavors in what a person wrote about a wine (their note and tags), read by
 * a language model so that "not oaky at all" or "campfire and cherries" mean
 * what they say - keyword matching (src/recs/flavors.ts) can't tell.
 *
 * The phone reads them itself when it has Apple Intelligence and sends them
 * with the tasting (source 'apple'). Otherwise the server asks an OpenRouter
 * free model in the background (source 'openrouter'): after a save, and for
 * older tastings when recommendations notice a rated note that hasn't been
 * read. Until either has read the current text, the profile falls back to
 * keywords.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import type { LlmProvider, NoteFlavors } from '../llm/types.js';
import { sanitizeNoteFlavors } from '../llm/sanitize.js';
import { normalize } from '../lib/normalize.js';
import type { FlavorProfile } from '../recs/flavors.js';

export type NoteFlavorSource = 'apple' | 'openrouter' | 'jev';

/** A failed read is tried again after this long. */
const RETRY_FAILED_HOURS = 24;

/** What a model reads: the tags, then the note. '' when there is nothing to read. */
export function noteText(notes: string | null | undefined, tags: unknown): string {
  const t = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  return [t.length ? `Tags: ${t.join(', ')}` : '', (notes ?? '').trim()].filter(Boolean).join('\n');
}

/** Identifies the text flavors were read from, so an edit makes them stale. Spacing and case don't count. */
export function noteHash(notes: string | null | undefined, tags: unknown): string {
  const text = normalize(noteText(notes, tags));
  return text ? createHash('md5').update(text).digest('hex') : '';
}

/**
 * Profile weights for flavors read from the person's own words. They count
 * more than researched notes (1) because they're what the person tasted:
 * a hint 1, clearly there 1.5 (what a keyword match counts), dominant 2.
 */
export function ownFlavorWeights(nf: NoteFlavors): FlavorProfile {
  return Object.fromEntries(Object.entries(nf).map(([k, i]) => [k, 0.5 + 0.5 * i])) as FlavorProfile;
}

/** The stored flavors, if they were read from the tasting's current note and tags. */
export function currentNoteFlavors(t: { notes?: string | null; tags?: unknown; note_flavors?: unknown; note_flavors_for?: string | null }): NoteFlavors | null {
  const hash = noteHash(t.notes, t.tags);
  if (!hash || t.note_flavors_for !== hash) return null;
  return sanitizeNoteFlavors(t.note_flavors);
}

/**
 * `providers`: tried in order until one reads the note (Jev, when switched
 * on, then OpenRouter's free models); the one that did is recorded as the source.
 */
export function createNoteFlavorReader(db: Db, providers: LlmProvider | (LlmProvider | null)[] | null, log: (msg: string) => void = console.error) {
  const queue: number[] = [];
  let running = false;
  let claiming = 0;
  let idle: Array<() => void> = [];
  const readers = (Array.isArray(providers) ? providers : [providers]).filter((p): p is LlmProvider => Boolean(p?.readNoteFlavors));
  const canRead = readers.length > 0;

  /** The first reader's answer, and which reader gave it. */
  async function readText(text: string): Promise<{ flavors: NoteFlavors; source: string }> {
    let lastErr: unknown = new Error('no reader');
    for (const p of readers) {
      try {
        return { flavors: await p.readNoteFlavors!(text), source: p.name };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async function read(tastingId: number): Promise<void> {
    try {
      const { rows: [t] } = await db.query('SELECT notes, tags FROM tastings WHERE tasting_id = $1', [tastingId]);
      const text = t ? noteText(t.notes, t.tags) : '';
      if (!text) return;
      const { flavors, source } = await readText(text);
      // Only if the note wasn't edited (or read on the phone) in the meantime.
      await db.query(
        `UPDATE tastings SET note_flavors = $2, note_flavors_source = $4, note_flavors_for = $3
          WHERE tasting_id = $1 AND note_flavors_for IS DISTINCT FROM $3`,
        [tastingId, JSON.stringify(flavors), noteHash(t.notes, t.tags), source]
      );
    } catch (err) {
      log(`note flavors ${tastingId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // One at a time: free models are rate limited, and nobody is waiting on these.
  function pump(): void {
    if (!running && queue.length) {
      running = true;
      void read(queue.shift()!).finally(() => {
        running = false;
        pump();
      });
    }
    if (!running && !queue.length && !claiming) {
      for (const done of idle) done();
      idle = [];
    }
  }

  return {
    /** Whether this server can read notes at all (an OpenRouter key is set). */
    available: canRead,

    /**
     * Read these tastings' notes in the background: rated ones only (what
     * the profile uses), skipping any whose current text has been read, that
     * have no text, or that failed lately.
     * Returns how many were queued.
     */
    async request(tastingIds: number[]): Promise<number> {
      if (!canRead || !tastingIds.length) return 0;
      claiming++;
      try {
        const { rows } = await db.query(
          `SELECT tasting_id, notes, tags, note_flavors_for FROM tastings
            WHERE tasting_id = ANY($1) AND rating IS NOT NULL
              AND (note_flavors_tried_at IS NULL OR note_flavors_tried_at < NOW() - make_interval(hours => $2))`,
          [tastingIds, RETRY_FAILED_HOURS]
        );
        const todo = rows.filter((r) => {
          const hash = noteHash(r.notes, r.tags);
          return hash && r.note_flavors_for !== hash && !queue.includes(Number(r.tasting_id));
        }).map((r) => Number(r.tasting_id));
        if (todo.length) {
          await db.query('UPDATE tastings SET note_flavors_tried_at = NOW() WHERE tasting_id = ANY($1)', [todo]);
          queue.push(...todo);
        }
        return todo.length;
      } finally {
        claiming--;
        pump();
      }
    },

    /** Resolves when nothing is queued or running (tests, shutdown). */
    drained(): Promise<void> {
      if (!running && !queue.length && !claiming) return Promise.resolve();
      return new Promise((resolve) => idle.push(resolve));
    },
  };
}

export type NoteFlavorReader = ReturnType<typeof createNoteFlavorReader>;
