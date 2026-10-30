import { describe, expect, it } from 'vitest';
import { calibrate, fitOf, MIN_FOR_PERCENT } from '../src/recs/fit.js';
import type { RatedWine } from '../src/recs/profile.js';

const wine = (grape: string, rating: number, flavors: Record<string, number> = {}): RatedWine =>
  ({ features: { grape, colour: grape === 'riesling' ? 'white' : 'red', style: 'still', flavors }, rating, priceCents: null });

describe('fit', () => {
  // Loves Nebbiolo and Pinot, doesn't like Shiraz.
  const rated = [
    wine('nebbiolo', 4.5, { tannic: 1, red_fruit: 1 }), wine('nebbiolo', 4.5, { tannic: 1, earthy: 1 }), wine('nebbiolo', 4, { red_fruit: 1, earthy: 1 }),
    wine('pinot noir', 4.5, { red_fruit: 1, light: 1 }), wine('pinot noir', 4, { red_fruit: 1, earthy: 1 }),
    wine('shiraz', 2, { full: 1, spice: 1 }), wine('shiraz', 2.5, { full: 1, black_fruit: 1 }), wine('shiraz', 2, { black_fruit: 1, spice: 1 }),
  ];

  it('learns from their own ratings that a higher score means likelier to enjoy, and says it in steps of 5', () => {
    const cal = calibrate(rated);
    expect(cal.n).toBe(8);
    expect(cal.a).toBeGreaterThan(0.3);
    const high = fitOf(cal, 0.8), low = fitOf(cal, -0.8);
    expect(high.percent! % 5).toBe(0);
    expect(high.percent!).toBeGreaterThan(low.percent!);
    expect(high.percent!).toBeLessThanOrEqual(95);
    expect(low.percent!).toBeGreaterThanOrEqual(5);
    expect(['strong', 'good']).toContain(high.band);
    expect(['unlikely', 'maybe']).toContain(low.band);
  });

  it('gives only a band with too few ratings, and stays near the prior', () => {
    const cal = calibrate(rated.slice(0, MIN_FOR_PERCENT - 1));
    expect(fitOf(cal, 0.5)).toMatchObject({ percent: null, basis: MIN_FOR_PERCENT - 1 });
    expect(calibrate([]).n).toBe(0);
  });

  it('says whether Jev agrees', () => {
    const cal = calibrate(rated);
    const f = fitOf(cal, 0.8);
    expect(fitOf(cal, 0.8, 3.8).jev).toBe(f.percent! >= 65 ? 'agrees' : 'unsure');
    expect(fitOf(cal, 0.8, 0.2).jev).toBe('unsure');
    expect(fitOf(cal, 0.8).jev).toBeUndefined();
  });
});
