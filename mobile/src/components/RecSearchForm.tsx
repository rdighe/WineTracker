/**
 * Find wines: a price range, styles, a region, tasting notes and food to
 * match. Every field is optional; Show wines runs the search.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Field, Label, Muted, space } from './ui';
import type { WineStyle } from './theme';
import type { RecSearch, RecStyle } from '../lib/types';

/** The styles a search offers; sweet covers dessert and fortified wines. */
export const SEARCH_STYLES: { key: RecStyle; label: string; dot: WineStyle }[] = [
  { key: 'red', label: 'Red', dot: 'red' },
  { key: 'white', label: 'White', dot: 'white' },
  { key: 'rose', label: 'Rosé', dot: 'rose' },
  { key: 'sparkling', label: 'Sparkling', dot: 'sparkling' },
  { key: 'sweet', label: 'Dessert', dot: 'fortified' },
];

/** One line saying what a search asks for, e.g. "Red, White · Burgundy · $40–$100 · with duck". */
export function describeSearch(s: RecSearch): string {
  const label = (k: RecStyle) => SEARCH_STYLES.find((x) => x.key === k)?.label ?? k;
  const price = s.minPrice && s.maxPrice ? `$${s.minPrice}–$${s.maxPrice}` : s.maxPrice ? `Under $${s.maxPrice}` : s.minPrice ? `From $${s.minPrice}` : '';
  return [
    s.styles?.map(label).join(', '),
    s.region,
    price,
    s.notes ? `tastes of ${s.notes}` : '',
    s.food ? `with ${s.food}` : '',
  ].filter(Boolean).join(' · ') || 'Any wine';
}

const dollarsIn = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return n > 0 ? Math.round(n) : undefined;
};

export function RecSearchForm({ initial, onSubmit }: { initial: RecSearch; onSubmit: (s: RecSearch) => void }) {
  const [styles, setStyles] = useState<RecStyle[]>(initial.styles ?? []);
  const [min, setMin] = useState(initial.minPrice ? String(initial.minPrice) : '');
  const [max, setMax] = useState(initial.maxPrice ? String(initial.maxPrice) : '');
  const [region, setRegion] = useState(initial.region ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [food, setFood] = useState(initial.food ?? '');

  const toggle = (k: RecStyle) => setStyles((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  let minPrice = dollarsIn(min);
  let maxPrice = dollarsIn(max);
  if (minPrice && maxPrice && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];

  function submit() {
    const s: RecSearch = {};
    if (styles.length) s.styles = styles;
    if (minPrice) s.minPrice = minPrice;
    if (maxPrice) s.maxPrice = maxPrice;
    if (region.trim()) s.region = region.trim();
    if (notes.trim()) s.notes = notes.trim();
    if (food.trim()) s.food = food.trim();
    onSubmit(s);
  }

  return (
    <View style={{ gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Label>Price range</Label>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <View style={{ flex: 1 }}><Field label="Min $" numeric keyboardType="number-pad" placeholder="Any" value={min} onChangeText={setMin} /></View>
          <View style={{ flex: 1 }}><Field label="Max $" numeric keyboardType="number-pad" placeholder="Any" value={max} onChangeText={setMax} /></View>
        </View>
      </View>
      <View style={{ gap: space[2] }}>
        <Label>Styles</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {SEARCH_STYLES.map((s) => (
            <Chip key={s.key} dot={s.dot} selected={styles.includes(s.key)} onPress={() => toggle(s.key)}>{s.label}</Chip>
          ))}
        </View>
        <Muted>None picked: any style.</Muted>
      </View>
      <Field label="Region" placeholder="Burgundy, Napa, Piedmont…" autoCapitalize="words" value={region} onChangeText={setRegion} returnKeyType="next" />
      <Field label="Tasting notes" placeholder="Cherry, earthy, crisp…" value={notes} onChangeText={setNotes} returnKeyType="next" />
      <Field label="Food pairings" placeholder="Roast duck, oysters, chocolate…" value={food} onChangeText={setFood} returnKeyType="search" onSubmitEditing={submit} />
      <Button title="Show wines" onPress={submit} />
    </View>
  );
}
