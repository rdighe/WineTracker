/**
 * The Cellar tab (bottles you own, and Saved) and the Journal tab (everything
 * you've tasted) share this list. The Cellar shows one cellar or all of them
 * (yours and those shared with you), what they cost and are worth now, and
 * leads to its racks, receipts and sharing. One entry per wine, gathering everything the
 * user did with it - bottles added to the cellar and every tasting - each
 * with its date, which can be changed. Cellar entries can be removed (their
 * notes stay as tastings) and tastings deleted.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dollars, shortDate, wineTitle } from '../lib/format';
import type { Cellar, Tasting } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Section, TastingRow } from './EntryRows';
import { SavedWines } from './SavedWines';
import { ChevronIcon, DocumentIcon, PeopleIcon, RackIcon } from './icons';
import { ProfileButton } from './ProfileButton';
import { WineFilters, activeCount, applyFilters, type Filters } from './WineFilters';
import { WineThumb } from './WineThumb';
import { Button, Card, Chip, Divider, ErrorText, Muted, PriceDelta, Rating, Segmented, Title, radius, size, space, type, useTheme, wineStyleOf } from './ui';

export type Mode = 'cellar' | 'tastings' | 'saved';
type Sort = 'recent' | 'value' | 'rating';

interface Group {
  wineId: number;
  wine: Tasting;
  rows: Tasting[];
  cellar: Tasting[];
  tasted: Tasting[];
  /** What the Tasted side lists: tastings, and cellar entries the user rated or wrote notes on. */
  notes: Tasting[];
  latest: string;
  bottles: number;
  /** Most recent rating given. */
  rating: number | null;
}

function group(rows: Tasting[]): Group[] {
  const by = new Map<number, Tasting[]>();
  for (const t of rows) by.set(t.wine_id, [...(by.get(t.wine_id) ?? []), t]);
  return [...by.values()].map((rs) => {
    const sorted = [...rs].sort((a, b) => b.tasted_on.localeCompare(a.tasted_on) || b.tasting_id - a.tasting_id);
    const cellar = sorted.filter((t) => t.kind === 'cellar');
    return {
      wineId: sorted[0]!.wine_id,
      wine: sorted[0]!,
      rows: sorted,
      cellar,
      tasted: sorted.filter((t) => t.kind !== 'cellar'),
      notes: sorted.filter((t) => t.kind !== 'cellar' || t.rating != null || Boolean(t.notes?.trim())),
      latest: sorted[0]!.tasted_on,
      bottles: cellar.reduce((s, t) => s + (t.bottles ?? 1), 0),
      rating: sorted.find((t) => t.rating != null)?.rating ?? null,
    };
  });
}

const change = (t: Tasting) => (t.paid_750_cents && t.market_now_cents ? (t.market_now_cents - t.paid_750_cents) / t.paid_750_cents : null);
const groupChange = (g: Group) => {
  const c = g.cellar.map(change).filter((x): x is number => x !== null);
  return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null;
};

/** Yes/no question: a native alert, or the browser's confirm on the web. */
export function MyWines({ side }: { side: 'cellar' | 'journal' }) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  // Cellar tab: ?mode=saved opens Saved. The Journal tab is always the tastings.
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setModeState] = useState<Mode>(side === 'journal' ? 'tastings' : params.mode === 'saved' ? 'saved' : 'cellar');
  const [rows, setRows] = useState<Tasting[] | null>(null);
  const [cellars, setCellars] = useState<Cellar[] | null>(null);
  // Which cellar the list shows: one, or all of them.
  const [cellarId, setCellarId] = useState<number | 'all'>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    setOpen(null);
    // Value sorting only means something for bottles you own.
    if (m === 'tastings' && sort === 'value') setSort('recent');
  };
  // A new ?mode= (arriving here after saving elsewhere) switches the list.
  const [seenMode, setSeenMode] = useState(params.mode);
  if (params.mode !== seenMode) {
    setSeenMode(params.mode);
    if (side === 'cellar' && (params.mode === 'cellar' || params.mode === 'saved')) setMode(params.mode);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, cs] = await Promise.all([api.tastings(), side === 'cellar' ? api.cellars() : null]);
      setRows(t.tastings);
      if (cs) {
        setCellars(cs.cellars);
        // A cellar that's gone (left, deleted): back to all.
        setCellarId((cur) => (cur !== 'all' && !cs.cellars.some((x) => x.cellarId === cur) ? 'all' : cur));
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api, side]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const inCellar = useMemo(() => (rows ?? []).filter((t) => t.kind !== 'cellar' || cellarId === 'all' || t.cellar_id === cellarId), [rows, cellarId]);
  const groups = useMemo(() => group(inCellar).filter((g) => (mode === 'cellar' ? g.cellar.length > 0 : g.notes.length > 0)), [inCellar, mode]);
  const narrowed = Boolean(query.trim()) || activeCount(filters) > 0;
  const visible = useMemo(() => {
    // A wine shows when anything recorded about it matches.
    const list = groups.filter((g) => applyFilters(g.rows, query, filters).length > 0);
    if (sort === 'value') list.sort((a, b) => (groupChange(b) ?? -Infinity) - (groupChange(a) ?? -Infinity));
    else if (sort === 'rating') list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    else list.sort((a, b) => b.latest.localeCompare(a.latest));
    return list;
  }, [groups, query, filters, sort]);

  // Cellar totals: the server's for the cellar(s) shown (sizes and unpriced bottles accounted for);
  // narrowed by a search or filter, the bottles listed that have both prices.
  const shown = (cellars ?? []).filter((x) => cellarId === 'all' || x.cellarId === cellarId);
  const cellarRows = visible.flatMap((g) => g.cellar).filter((t) => t.paid_750_cents && t.market_now_cents);
  const paid = narrowed || !cellars ? cellarRows.reduce((s, t) => s + t.paid_750_cents! * (t.bottles ?? 1), 0) : shown.reduce((s, x) => s + x.costCents, 0);
  const worth = narrowed || !cellars ? cellarRows.reduce((s, t) => s + t.market_now_cents! * (t.bottles ?? 1), 0) : shown.reduce((s, x) => s + x.valueCents, 0);
  const unpriced = narrowed ? 0 : shown.reduce((s, x) => s + x.unpriced, 0);
  // The change compares bottles with both prices only.
  const pairedPaid = narrowed || !cellars ? paid : shown.reduce((s, x) => s + x.pairedCostCents, 0);
  const pairedNow = narrowed || !cellars ? worth : shown.reduce((s, x) => s + x.pairedValueCents, 0);
  const bottles = visible.reduce((s, g) => s + g.bottles, 0);
  const here = cellarId === 'all' ? (cellars && cellars.length > 1 ? 'across your cellars' : 'in your cellar') : `in ${shown[0]?.name ?? 'this cellar'}`;
  const countLine = mode === 'cellar'
    ? `${visible.length} ${visible.length === 1 ? 'wine' : 'wines'} · ${bottles} ${bottles === 1 ? 'bottle' : 'bottles'} ${here}`
    : `${visible.length} ${visible.length === 1 ? 'wine' : 'wines'} tasted`;
  const current = cellarId === 'all' ? null : shown[0] ?? null;
  const shared = (cellars ?? []).some((x) => x.members.length > 1);

  // Cellar / Saved on the Cellar tab; the Journal has one list.
  const modeSwitch = side === 'cellar'
    ? <Segmented<Mode> small tinted options={[{ key: 'cellar', label: 'Bottles' }, { key: 'saved', label: 'Saved' }]} value={mode} onChange={setMode} />
    : null;
  if (mode === 'saved') return <SavedWines modeSwitch={modeSwitch} />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120 }}
      data={visible}
      // A new key per side, so switching Cellar / Tasted fades the new list in.
      key={mode}
      keyExtractor={(g) => `${mode}-${g.wineId}`}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.ink3} />}
      ListHeaderComponent={
        <View style={{ gap: space[4], marginBottom: space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] }}>
            <View style={{ flex: 1 }}>
              <Title>{side === 'journal' ? 'Journal' : 'Cellar'}</Title>
              <Muted style={{ marginTop: 2 }}>{rows ? countLine : ' '}</Muted>
            </View>
            <ProfileButton />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
            <Segmented<Sort>
              small
              options={mode === 'cellar'
                ? [{ key: 'recent', label: 'Recent' }, { key: 'value', label: 'Value' }, { key: 'rating', label: 'Rating' }]
                : [{ key: 'recent', label: 'Recent' }, { key: 'rating', label: 'Rating' }]}
              value={sort}
              onChange={setSort}
            />
            {modeSwitch}
          </View>
          {mode === 'cellar' && cellars && (cellars.length > 1 || shared) ? (
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Chip small selected={cellarId === 'all'} onPress={() => setCellarId('all')}>All cellars</Chip>
              {cellars.map((x) => (
                <Chip key={x.cellarId} small selected={cellarId === x.cellarId} onPress={() => setCellarId(x.cellarId)}>
                  {x.members.length > 1 ? `${x.name} · ${x.members.length} people` : x.name}
                </Chip>
              ))}
            </View>
          ) : null}
          {mode === 'cellar' ? (
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button title="Racks" variant="secondary" size="sm" style={{ flex: 1 }} icon={(fg) => <RackIcon color={fg} size={18} />}
                onPress={() => router.push(`/racks?cellar=${current?.cellarId ?? cellars?.[0]?.cellarId ?? ''}`)} />
              <Button title="Receipts" variant="secondary" size="sm" style={{ flex: 1 }} icon={(fg) => <DocumentIcon color={fg} size={18} />} onPress={() => router.push('/receipts')} />
              <Button title={shared ? 'Shared' : 'Share'} variant="secondary" size="sm" style={{ flex: 1 }} icon={(fg) => <PeopleIcon color={fg} size={18} />}
                onPress={() => router.push(current ? `/cellars?id=${current.cellarId}` : '/cellars')} />
            </View>
          ) : null}
          {groups.length ? <WineFilters items={groups.flatMap((g) => g.rows)} query={query} onQuery={setQuery} filters={filters} onFilters={setFilters} /> : null}
          {mode === 'cellar' && paid > 0 && worth > 0 && (
            <Animated.View entering={FadeIn.duration(220)} style={{ gap: space[1] }}>
              <Card style={{ flexDirection: 'row', padding: 0, gap: 0 }}>
                <Stat label="Cost" value={dollars(paid)} />
                <Stat label="Value now" value={dollars(worth)} />
                <Stat label="Change" value={pairedPaid ? <PriceDelta paid={pairedPaid} now={pairedNow} percentOnly /> : '–'} />
              </Card>
              {unpriced ? <Muted style={{ color: c.ink3 }}>{`${unpriced} ${unpriced === 1 ? 'bottle has' : 'bottles have'} no market price yet; counted at what ${unpriced === 1 ? 'it' : 'they'} cost.`}</Muted> : null}
            </Animated.View>
          )}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={
        rows && narrowed && groups.length ? (
          <View style={{ gap: space[3], alignItems: 'flex-start' }}>
            <Muted>No wines match.</Muted>
            <Button title="Clear search and filters" variant="secondary" size="sm" onPress={() => { setQuery(''); setFilters({}); }} />
          </View>
        ) : rows ? (
          <Muted style={type.subhead}>{mode === 'cellar' ? 'No bottles in your cellar yet. Add a wine and choose "In my cellar".' : 'No tastings yet. Add a wine and log what you thought of it.'}</Muted>
        ) : null
      }
      renderItem={({ item: g, index }) => (
        <WineEntry
          g={g}
          mode={mode}
          index={index}
          first={index === 0}
          last={index === visible.length - 1}
          open={open === g.wineId}
          // Cellar rows go straight to the wine's page (its bottles and tastings are there); Tasted rows open in place.
          onToggle={() => (mode === 'cellar' ? router.push(`/wine/${g.wineId}`) : setOpen(open === g.wineId ? null : g.wineId))}
          onChanged={load}
        />
      )}
    />
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2, paddingVertical: space[3], paddingHorizontal: space[4], borderLeftWidth: label === 'Cost' ? 0 : StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <Muted>{label}</Muted>
      {typeof value === 'string' ? <Text style={[type.figure, { color: c.ink }]}>{value}</Text> : <View style={{ minHeight: 22, justifyContent: 'center' }}>{value}</View>}
    </View>
  );
}

/** Rows ease into place as one opens or closes: a short slide, no bounce. */
const rowLayout = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));

/** One wine as a row in a grouped list: thumbnail, name, what you have or tasted, and its price. Tap to open. */
function WineEntry({ g, mode, index, first, last, open, onToggle, onChanged }: {
  g: Group; mode: Mode; index: number; first: boolean; last: boolean; open: boolean; onToggle: () => void; onChanged: () => Promise<void>;
}) {
  const { c } = useTheme();
  const w = g.wine;
  const vintages = [...new Set(g.cellar.map((t) => t.vintage_key ?? 'NV'))].sort().reverse();
  const market = (mode === 'cellar' ? g.cellar : g.notes).find((t) => t.market_now_cents)?.market_now_cents ?? null;
  const ratedInCellar = g.notes.filter((t) => t.kind === 'cellar').length;
  const tastedLine = g.tasted.length
    ? `Tasted ${g.tasted.length === 1 ? 'once' : `${g.tasted.length} times`}${ratedInCellar ? ' · rated in your cellar' : ''} · ${shortDate(g.tasted[0]?.tasted_on)}`
    : `Rated in your cellar · ${shortDate(g.notes[0]?.tasted_on)}`;
  const summary = mode === 'cellar' ? `${g.bottles} ${g.bottles === 1 ? 'bottle' : 'bottles'} · ${vintages.join(', ')}` : tastedLine;
  const firstVintage = (mode === 'cellar' ? g.cellar : g.notes)[0]?.vintage_key ?? '';
  const change = groupChange(g);
  const name = wineTitle(w.display_name, w.sub_region);
  // Cellar rows: where the bottles sit and who added them, when that's someone else.
  const placed = g.cellar.flatMap((t) => t.places ?? []);
  const racks = [...new Set(placed.map((p) => p.rack))];
  const where = mode !== 'cellar' ? '' : [
    placed.length === 1 ? `${placed[0]!.rack} · row ${placed[0]!.row + 1}, place ${placed[0]!.col + 1}` : racks.length ? `${placed.length} on ${racks.join(', ')}` : '',
    g.cellar.find((t) => t.added_by)?.added_by ? `Added by ${g.cellar.find((t) => t.added_by)!.added_by}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Animated.View
      // Rows slide in a few at a time when the list appears, and slide gently as one opens or closes.
      entering={FadeInDown.duration(260).delay(Math.min(index, 8) * 30)}
      layout={rowLayout}
      style={{
        backgroundColor: c.surface, borderColor: c.hairline, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
        borderTopWidth: first ? StyleSheet.hairlineWidth : 0, borderBottomWidth: last ? StyleSheet.hairlineWidth : 0,
        borderTopLeftRadius: first ? radius.md : 0, borderTopRightRadius: first ? radius.md : 0,
        borderBottomLeftRadius: last ? radius.md : 0, borderBottomRightRadius: last ? radius.md : 0, overflow: 'hidden',
      }}
    >
      {first ? null : <Divider style={{ marginLeft: space[4] + size.thumbW + space[3] }} />}
      <Pressable
        accessibilityRole="button"
        accessibilityState={mode === 'cellar' ? undefined : { expanded: open }}
        accessibilityHint={mode === 'cellar' ? 'Opens the wine page' : undefined}
        accessibilityLabel={`${name}, ${summary}${market ? `, now ${dollars(market)}` : ''}${g.rating != null ? `, rated ${g.rating}` : ''}`}
        onPress={onToggle}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.rowPhoto, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
      >
        <WineThumb uri={w.image_url} wineStyle={wineStyleOf(w.colour, w.wine_type)} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{name}</Text>
          <Text style={[type.subhead, { color: c.ink2 }]} numberOfLines={1}>{[w.sub_region || w.region, summary].filter(Boolean).join(' · ')}</Text>
          {where ? <Text style={[type.footnote, { color: c.ink3 }]} numberOfLines={1}>{where}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          {market ? <Text style={[type.figure, { color: c.ink }]}>{dollars(market)}</Text> : <Muted style={{ color: c.ink3 }}>No price</Muted>}
          {mode === 'cellar' && change !== null ? (
            <PriceDelta change={change} />
          ) : g.rating != null ? (
            <Rating value={g.rating} />
          ) : null}
        </View>
        <ChevronIcon color={c.ink3} direction={mode === 'cellar' ? 'right' : open ? 'up' : 'down'} />
      </Pressable>

      {open && mode === 'tastings' ? (
        <Animated.View entering={FadeIn.duration(200).delay(40)} exiting={FadeOut.duration(120)} style={{ gap: space[4], paddingHorizontal: space[4], paddingBottom: space[4] }}>
          {g.cellar.length ? (
            <Muted>
              In your cellar: {g.bottles} {g.bottles === 1 ? 'bottle' : 'bottles'} ({vintages.join(', ')})
            </Muted>
          ) : null}
          <Section title="Tastings">
            {g.notes.length ? g.notes.map((t) => <TastingRow key={t.tasting_id} t={t} onChanged={onChanged} />) : <Muted>Not tasted yet.</Muted>}
          </Section>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button title="Log tasting" variant="tinted" size="sm" onPress={() => router.push(`/wine/${g.wineId}?add=tasted&vintage=${encodeURIComponent(firstVintage)}`)} />
            <Button title="Add bottles" variant="secondary" size="sm" onPress={() => router.push(`/wine/${g.wineId}?add=cellar&vintage=${encodeURIComponent(firstVintage)}`)} />
            <Button title="Wine page" variant="secondary" size="sm" onPress={() => router.push(`/wine/${g.wineId}`)} icon={(fg) => <ChevronIcon color={fg} size={14} />} />
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
