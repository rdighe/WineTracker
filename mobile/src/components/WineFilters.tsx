/** Search box and "Filter by" panel for the Cellar and Journal (by style, place, grape, rating, vintage, your tags, rack); filtering happens on the phone. */
import { useMemo, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import type { Tasting } from '../lib/types';
import { FilterIcon, SearchIcon } from './icons';
import { Button, Card, Chip, Label, radius, space, type, useStyles, useTheme, wineStyleOf } from './ui';

export interface Filters {
  colour?: string;
  country?: string;
  region?: string;
  grape?: string;
  rating?: string;
  vintage?: string;
  tag?: string;
  /** A rack's name, or NOT_PLACED. */
  place?: string;
}
const NOT_PLACED = 'Not on a rack';
const placesOf = (t: Tasting) => (t.kind !== 'cellar' ? [] : t.places?.length ? t.places.map((p) => p.rack) : [NOT_PLACED]);
type Key = keyof Filters;

/** Lowercase without accents, so "chateau" finds "Château". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COLOR_LABEL: Record<string, string> = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', dessert: 'Dessert', fortified: 'Fortified' };
const colors = (t: Tasting) => [t.colour, t.wine_type === 'still' ? '' : t.wine_type].filter(Boolean);
const regionOf = (t: Tasting) => t.sub_region || t.region;
/** "Cabernet Sauvignon, Merlot" -> both grapes. */
const grapesOf = (t: Tasting) => (t.grape ?? '').split(/[,/&+]| and /).map((g) => g.replace(/\d+\s*%/g, '').trim()).filter(Boolean);
const RATINGS = [
  { key: '4.5', label: '4.5+', test: (r: number | null) => r != null && r >= 4.5 },
  { key: '4', label: '4+', test: (r: number | null) => r != null && r >= 4 },
  { key: '3', label: '3+', test: (r: number | null) => r != null && r >= 3 },
  { key: 'unrated', label: 'Unrated', test: (r: number | null) => r == null },
];
const vintageBucket = (v: string | null) => {
  if (!v) return 'Unknown';
  if (v === 'NV') return 'NV';
  const y = Number(v);
  return y >= 1990 ? `${Math.floor(y / 10) * 10}s` : 'Before 1990';
};

function matches(t: Tasting, f: Filters, words: string[]): boolean {
  if (f.colour && !colors(t).includes(f.colour)) return false;
  if (f.country && t.country !== f.country) return false;
  if (f.region && regionOf(t) !== f.region) return false;
  if (f.grape && !grapesOf(t).includes(f.grape)) return false;
  if (f.rating && !RATINGS.find((r) => r.key === f.rating)?.test(t.rating)) return false;
  if (f.vintage && vintageBucket(t.vintage_key) !== f.vintage) return false;
  if (f.tag && !(t.tags ?? []).includes(f.tag)) return false;
  if (f.place && !placesOf(t).includes(f.place)) return false;
  if (!words.length) return true;
  const hay = fold([t.display_name, t.producer, t.region, t.sub_region, t.country, t.grape, t.vintage_key, t.notes, ...(t.tags ?? [])].filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}

export function applyFilters(items: Tasting[], query: string, f: Filters): Tasting[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return items.filter((t) => matches(t, f, words));
}

/** Values present in the list, most common first. */
function options(items: Tasting[], values: (t: Tasting) => string[], max = 12): { key: string; label: string }[] {
  const n = new Map<string, number>();
  for (const t of items) for (const v of new Set(values(t))) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([key]) => ({ key, label: COLOR_LABEL[key] ?? key }));
}

export function activeCount(f: Filters): number {
  return Object.values(f).filter(Boolean).length;
}

export function WineFilters({ items, query, onQuery, filters, onFilters }: {
  items: Tasting[]; query: string; onQuery: (q: string) => void; filters: Filters; onFilters: (f: Filters) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const decades = options(items, (t) => [vintageBucket(t.vintage_key)]).sort((a, b) => b.key.localeCompare(a.key));
    return ([
      ['colour', 'Color & style', options(items, colors)],
      ['country', 'Country', options(items, (t) => [t.country])],
      ['region', 'Region', options(items, (t) => [regionOf(t)])],
      ['grape', 'Grape', options(items, grapesOf)],
      ['rating', 'Your rating', RATINGS.filter((r) => items.some((t) => r.test(t.rating))).map(({ key, label }) => ({ key, label }))],
      ['vintage', 'Vintage', decades],
      ['tag', 'Your tags', options(items, (t) => t.tags ?? [], 20)],
      ['place', 'Rack', options(items, placesOf)],
    ] as [Key, string, { key: string; label: string }[]][]).filter(([, , opts]) => opts.length > 0);
  }, [items]);
  const n = activeCount(filters);
  const toggle = (k: Key, v: string) => onFilters({ ...filters, [k]: filters[k] === v ? undefined : v });
  const { c, scheme } = useTheme();
  const s = useStyles();

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
        <View style={[s.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.pill }]}>
          <SearchIcon color={c.ink3} size={18} />
          <TextInput
            accessibilityLabel="Search your wines"
            value={query}
            onChangeText={onQuery}
            placeholder="Search wines or producers"
            placeholderTextColor={c.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            keyboardAppearance={scheme}
            style={[type.callout, { flex: 1, minHeight: 42, color: c.ink }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
          />
        </View>
        <Button
          title={n ? `Filter · ${n}` : 'Filter'}
          variant={n ? 'tinted' : 'secondary'}
          size="md"
          accessibilityLabel={n ? `Filter by, ${n} active` : 'Filter by'}
          icon={(fg) => <FilterIcon color={fg} />}
          onPress={() => setOpen(!open)}
        />
      </View>

      {open ? (
        <Card style={{ gap: space[4] }}>
          {groups.map(([k, title, opts]) => (
            <View key={k} style={{ gap: space[2] }}>
              <Label>{title}</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {opts.map((o) => (
                  <Chip key={o.key} small selected={filters[k] === o.key} dot={k === 'colour' && o.key in COLOR_LABEL ? wineStyleOf(o.key, o.key) : undefined} onPress={() => toggle(k, o.key)}>{o.label}</Chip>
                ))}
              </View>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button title="Clear filters" variant="plain" size="sm" disabled={!n} onPress={() => onFilters({})} />
            <Button title="Done" variant="secondary" size="sm" onPress={() => setOpen(false)} />
          </View>
        </Card>
      ) : n ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(Object.entries(filters) as [Key, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
            <Chip key={k} small selected onPress={() => onFilters({ ...filters, [k]: undefined })}>
              {`${k === 'rating' ? RATINGS.find((r) => r.key === v)?.label : COLOR_LABEL[v!] ?? v}  ×`}
            </Chip>
          ))}
        </View>
      ) : null}
    </View>
  );
}
