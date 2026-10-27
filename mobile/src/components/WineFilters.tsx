/** Search box and "Filter by" panel for My wines; filtering happens on the phone. */
import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import type { Tasting } from '../lib/types';
import { SearchIcon } from './icons';
import { Button, Chip, Eyebrow, colors, fonts, styles } from './ui';

export interface Filters {
  colour?: string;
  country?: string;
  region?: string;
  grape?: string;
  rating?: string;
  vintage?: string;
}
type Key = keyof Filters;

/** Lowercase without accents, so "chateau" finds "Château". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COLOUR_LABEL: Record<string, string> = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', dessert: 'Dessert', fortified: 'Fortified' };
const colours = (t: Tasting) => [t.colour, t.wine_type === 'still' ? '' : t.wine_type].filter(Boolean);
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
  if (f.colour && !colours(t).includes(f.colour)) return false;
  if (f.country && t.country !== f.country) return false;
  if (f.region && regionOf(t) !== f.region) return false;
  if (f.grape && !grapesOf(t).includes(f.grape)) return false;
  if (f.rating && !RATINGS.find((r) => r.key === f.rating)?.test(t.rating)) return false;
  if (f.vintage && vintageBucket(t.vintage_key) !== f.vintage) return false;
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
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([key]) => ({ key, label: COLOUR_LABEL[key] ?? key }));
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
      ['colour', 'Colour & style', options(items, colours)],
      ['country', 'Country', options(items, (t) => [t.country])],
      ['region', 'Region', options(items, (t) => [regionOf(t)])],
      ['grape', 'Grape', options(items, grapesOf)],
      ['rating', 'Your rating', RATINGS.filter((r) => items.some((t) => r.test(t.rating))).map(({ key, label }) => ({ key, label }))],
      ['vintage', 'Vintage', decades],
    ] as [Key, string, { key: string; label: string }[]][]).filter(([, , opts]) => opts.length > 0);
  }, [items]);
  const n = activeCount(filters);
  const toggle = (k: Key, v: string) => onFilters({ ...filters, [k]: filters[k] === v ? undefined : v });

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0 }]}>
          <SearchIcon color={colors.faint} />
          <TextInput
            accessibilityLabel="Search your wines"
            value={query}
            onChangeText={onQuery}
            placeholder="Search wines or producers"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[{ flex: 1, minHeight: 44, color: colors.text, fontFamily: fonts.regular, fontSize: 15 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={n ? `Filter by, ${n} active` : 'Filter by'}
          onPress={() => setOpen(!open)}
          style={({ pressed }) => [
            { height: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: n ? colors.gold : colors.line2, justifyContent: 'center' },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: n ? colors.gold : colors.text }}>{n ? `Filter · ${n}` : 'Filter'}</Text>
        </Pressable>
      </View>

      {open ? (
        <View style={{ gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
          {groups.map(([k, title, opts]) => (
            <View key={k} style={{ gap: 8 }}>
              <Eyebrow style={{ fontSize: 10 }}>{title}</Eyebrow>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {opts.map((o) => (
                  <Chip key={o.key} tone={filters[k] === o.key ? 'gold' : 'plain'} onPress={() => toggle(k, o.key)}>{o.label}</Chip>
                ))}
              </View>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button title="Clear filters" variant="pill" style={{ borderColor: colors.line2 }} disabled={!n} onPress={() => onFilters({})} />
            <Button title="Done" variant="pill" style={{ borderColor: colors.line2 }} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : n ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(Object.entries(filters) as [Key, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
            <Chip key={k} tone="gold" onPress={() => onFilters({ ...filters, [k]: undefined })}>
              {`${k === 'rating' ? RATINGS.find((r) => r.key === v)?.label : COLOUR_LABEL[v!] ?? v}  ×`}
            </Chip>
          ))}
        </View>
      ) : null}
    </View>
  );
}
