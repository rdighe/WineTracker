/**
 * How well For you's taste profile predicts each person's own ratings
 * (src/recs/evaluate.ts), with their own notes' flavors three ways: as read
 * by a model (keywords where none has yet), by keywords only, and not at all.
 *
 *   npm run eval:recs                       every user with enough ratings
 *   npm run eval:recs -- --user 1           one user
 *   npm run eval:recs -- --min-rated 5      fewer ratings needed (default 8)
 *   npm run eval:recs -- --sample 3000      catalog wines to rank against (default 3000; 0 = skip)
 *   npm run eval:recs -- --read-notes       first read unread rated notes with OpenRouter (writes them to the database)
 *   npm run eval:recs -- --jev              also test Jev's predictions (src/recs/jevPredict.ts) against the profile score,
 *                                           and whether a fit Jev agrees with is right more often:
 *                                           one OpenRouter call per rated wine; needs OPENROUTER_API_KEY
 *
 * Each user also gets the fit the app shows (src/recs/fit.ts) checked against
 * what they rated: Brier score, and how often each band's wines were enjoyed.
 *
 * Uses DATABASE_URL. Only reads, unless --read-notes is given.
 */
import { createPool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { createJev, createNoteProvider } from '../src/llm/index.js';
import { JevClient, jevNoteReader } from '../src/llm/jev.js';
import { predictEnjoyment } from '../src/recs/jevPredict.js';
import { evaluateFit, evaluateJev, evaluateUser, type CatalogWine, type EvalResult } from '../src/recs/evaluate.js';
import { candidates, loadRatedTastings, MIN_RATED, type OwnFlavors } from '../src/recs/recommend.js';
import { createNoteFlavorReader } from '../src/tastings/noteFlavors.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const onlyUser = arg('user') ? Number(arg('user')) : null;
const minRated = Math.max(MIN_RATED + 1, Number(arg('min-rated') ?? 8));
const sampleSize = Number(arg('sample') ?? 3000);
const readNotes = process.argv.includes('--read-notes');
const withJev = process.argv.includes('--jev');

const db = createPool();
try {
  const { rows: users } = await db.query(
    `SELECT user_id, count(*)::int AS rated FROM tastings WHERE rating IS NOT NULL AND ($1::bigint IS NULL OR user_id = $1)
      GROUP BY user_id HAVING count(*) >= $2 ORDER BY user_id`,
    [onlyUser, minRated]
  );
  if (!users.length) {
    console.log(`No user with at least ${minRated} rated tastings.`);
  }

  if (readNotes && users.length) {
    const jevFlavors = createJev('flavors');
    const reader = createNoteFlavorReader(db, [jevFlavors && jevNoteReader(jevFlavors), createNoteProvider()], (m) => console.log(`  ${m}`));
    if (!reader.available) throw new Error('--read-notes needs OPENROUTER_API_KEY');
    for (const u of users) {
      const { rated } = await loadRatedTastings(db, u.user_id, { seeds: false });
      const n = await reader.request(rated.filter((t) => t.own.hasText && !t.own.read).map((t) => t.tastingId));
      console.log(`user ${u.user_id}: reading ${n} notes...`);
      await reader.drained();
    }
  }

  // An even spread of the priced catalog, the same for every run.
  let catalog: CatalogWine[] = [];
  if (sampleSize > 0 && users.length) {
    const all = (await candidates(db)).sort((a, b) => a.r.wine_id - b.r.wine_id);
    const step = Math.max(1, all.length / sampleSize);
    for (let i = 0; i < all.length && catalog.length < sampleSize; i += step) {
      const c = all[Math.floor(i)]!;
      catalog.push({ wineId: Number(c.r.wine_id), features: c.f, priceCents: c.r.median_cents });
    }
    console.log(`Ranking liked wines against ${catalog.length} of ${all.length} priced wines.\n`);
  }

  const pct = (x: number | null) => (x === null ? '   -' : `${(100 * x).toFixed(0).padStart(3)}%`);
  const num = (x: number | null) => (x === null ? '    -' : x.toFixed(2).padStart(5));
  const MODES: [OwnFlavors, string][] = [['read', 'notes read by model'], ['keywords', 'notes by keywords'], ['none', 'notes ignored']];
  const totals = new Map<OwnFlavors, EvalResult[]>(MODES.map(([m]) => [m, []]));

  for (const u of users) {
    const { rated } = await loadRatedTastings(db, u.user_id, { seeds: false });
    const withText = rated.filter((t) => t.own.hasText).length;
    const read = rated.filter((t) => t.own.read).length;
    console.log(`user ${u.user_id}: ${rated.length} rated tastings, ${withText} with notes or tags, ${read} of those read by a model`);
    console.log('  own notes              concord  spearman  liked  median rank  top 5%  top 10%');
    for (const [mode, label] of MODES) {
      const r = evaluateUser(rated, mode, catalog);
      totals.get(mode)!.push(r);
      console.log(`  ${label.padEnd(21)}  ${pct(r.concordance)}     ${num(r.spearman)}  ${String(r.liked).padStart(5)}  ${pct(r.likedMedianPct).padStart(11)}  ${pct(r.likedTop5).padStart(6)}  ${pct(r.likedTop10).padStart(7)}`);
    }
    let jevByWine: Map<number, number> | undefined;
    if (withJev) {
      if (!config.openrouterApiKey) throw new Error('--jev needs OPENROUTER_API_KEY');
      const jev = new JevClient({ apiKey: config.openrouterApiKey, model: config.jevModel || undefined });
      const j = await evaluateJev(rated, async (others, wine) => (await predictEnjoyment(jev, others, [{ key: 'w', label: wine.label }])).get('w')?.score ?? null);
      console.log(`  jev: answered ${j.answered} of ${j.wines} wines (measured on those)`);
      for (const [label, m] of [['profile score', j.profile], ['jev alone', j.jev], ['profile + jev', j.blended]] as const) {
        console.log(`  ${label.padEnd(21)}  ${pct(m.concordance)}     ${num(m.spearman)}`);
      }
      jevByWine = j.byWine;
    }
    const fit = evaluateFit(rated, jevByWine);
    const band = (b: keyof typeof fit.bands) => (fit.bands[b].n ? `${b} ${fit.bands[b].enjoyed}/${fit.bands[b].n} enjoyed` : `${b} -`);
    console.log(`  fit: brier ${num(fit.brier)} (0.25 = coin flip) · ${(['strong', 'good', 'maybe', 'unlikely'] as const).map(band).join(' · ')}`);
    if (fit.jev) {
      const r = (x: { n: number; right: number }) => (x.n ? `${x.right}/${x.n} right` : '-');
      console.log(`  fit when jev agrees: ${r(fit.jev.agrees)} · when jev is unsure: ${r(fit.jev.unsure)}`);
    }
    console.log('');
  }

  if (users.length > 1) {
    // Users weighted by how many pairs or liked wines they contribute.
    const wavg = (rs: EvalResult[], v: (r: EvalResult) => number | null, w: (r: EvalResult) => number) => {
      const xs = rs.filter((r) => v(r) !== null && w(r) > 0);
      const tw = xs.reduce((s, r) => s + w(r), 0);
      return tw ? xs.reduce((s, r) => s + v(r)! * w(r), 0) / tw : null;
    };
    console.log(`all ${users.length} users`);
    for (const [mode, label] of MODES) {
      const rs = totals.get(mode)!;
      console.log(`  ${label.padEnd(21)}  ${pct(wavg(rs, (r) => r.concordance, (r) => r.pairs))}     ${num(wavg(rs, (r) => r.spearman, (r) => r.wines))}  ${String(rs.reduce((s, r) => s + r.liked, 0)).padStart(5)}  ${pct(wavg(rs, (r) => r.likedMedianPct, (r) => r.liked)).padStart(11)}  ${pct(wavg(rs, (r) => r.likedTop5, (r) => r.liked)).padStart(6)}  ${pct(wavg(rs, (r) => r.likedTop10, (r) => r.liked)).padStart(7)}`);
    }
  }
  console.log('\nconcord: of two wines rated differently, how often the better one scores higher (50% = chance).');
  console.log('median rank: where a liked wine (4+) would land among the priced catalog, from the top (lower is better).');
} finally {
  await db.end();
}
