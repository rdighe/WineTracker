/**
 * My Cellar and My Tastings: one entry per wine, gathering everything the
 * user did with it - bottles added to the cellar and every tasting - each
 * with its date, which can be changed. Cellar entries can be removed (their
 * notes stay as tastings) and tastings deleted.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { dollars, shortDate, wineTitle } from '../lib/format';
import type { ImportSummary, Tasting } from '../lib/types';
import { useApi } from '../lib/useApi';
import { AppearanceSettings } from './Appearance';
import { DateField } from './DateField';
import { ChevronIcon } from './icons';
import { WineFilters, activeCount, applyFilters, type Filters } from './WineFilters';
import { WineThumb } from './WineThumb';
import { Button, Card, Divider, ErrorText, Heading, Label, Muted, PriceDelta, Rating, Segmented, Title, radius, size, space, type, useTheme, wineStyleOf } from './ui';

export type Mode = 'cellar' | 'tastings';
type Sort = 'recent' | 'value' | 'rating';

interface Group {
  wineId: number;
  wine: Tasting;
  rows: Tasting[];
  cellar: Tasting[];
  tasted: Tasting[];
  /** What My Tastings lists: tastings, and cellar entries the user rated or wrote notes on. */
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
function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ])
  );
}

export function MyWines({ mode }: { mode: Mode }) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const { label, signOut } = useAuth();
  const [rows, setRows] = useState<Tasting[] | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await api.tastings()).tastings);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const groups = useMemo(() => group(rows ?? []).filter((g) => (mode === 'cellar' ? g.cellar.length > 0 : g.notes.length > 0)), [rows, mode]);
  const narrowed = Boolean(query.trim()) || activeCount(filters) > 0;
  const visible = useMemo(() => {
    // A wine shows when anything recorded about it matches.
    const list = groups.filter((g) => applyFilters(g.rows, query, filters).length > 0);
    if (sort === 'value') list.sort((a, b) => (groupChange(b) ?? -Infinity) - (groupChange(a) ?? -Infinity));
    else if (sort === 'rating') list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    else list.sort((a, b) => b.latest.localeCompare(a.latest));
    return list;
  }, [groups, query, filters, sort]);

  // Cellar totals: what the bottles cost and are worth now (per bottle x bottles), where both are known.
  const cellarRows = visible.flatMap((g) => g.cellar).filter((t) => t.paid_750_cents && t.market_now_cents);
  const paid = cellarRows.reduce((s, t) => s + t.paid_750_cents! * (t.bottles ?? 1), 0);
  const worth = cellarRows.reduce((s, t) => s + t.market_now_cents! * (t.bottles ?? 1), 0);
  const bottles = visible.reduce((s, g) => s + g.bottles, 0);
  const countLine = mode === 'cellar'
    ? `${visible.length} ${visible.length === 1 ? 'wine' : 'wines'} · ${bottles} ${bottles === 1 ? 'bottle' : 'bottles'}`
    : `${visible.length} ${visible.length === 1 ? 'wine' : 'wines'} tasted`;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120 }}
      data={visible}
      keyExtractor={(g) => String(g.wineId)}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.ink3} />}
      ListHeaderComponent={
        <View style={{ gap: space[4], marginBottom: space[4] }}>
          <View>
            <Title>{mode === 'cellar' ? 'My cellar' : 'My tastings'}</Title>
            <Muted style={{ marginTop: 2 }}>{rows ? countLine : ' '}</Muted>
          </View>
          <View style={{ alignSelf: 'flex-start' }}>
            <Segmented
              small
              options={mode === 'cellar'
                ? [{ key: 'recent', label: 'Recent' }, { key: 'value', label: 'Value' }, { key: 'rating', label: 'Rating' }]
                : [{ key: 'recent', label: 'Recent' }, { key: 'rating', label: 'Rating' }]}
              value={sort}
              onChange={setSort}
            />
          </View>
          {groups.length ? <WineFilters items={groups.flatMap((g) => g.rows)} query={query} onQuery={setQuery} filters={filters} onFilters={setFilters} /> : null}
          {mode === 'cellar' && cellarRows.length > 0 && (
            <Card style={{ flexDirection: 'row', padding: 0, gap: 0 }}>
              <Stat label="Cost" value={dollars(paid)} />
              <Stat label="Value now" value={dollars(worth)} />
              <Stat label="Change" value={<PriceDelta paid={paid} now={worth} percentOnly />} />
            </Card>
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
          first={index === 0}
          last={index === visible.length - 1}
          open={open === g.wineId}
          onToggle={() => setOpen(open === g.wineId ? null : g.wineId)}
          onChanged={load}
        />
      )}
      ListFooterComponent={
        <View style={{ marginTop: space[6], gap: space[5] }}>
          {mode === 'tastings' ? <VivinoImport onDone={load} /> : null}
          <AppearanceSettings />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Muted>Signed in as {label}</Muted>
            <Button title="Sign out" variant="secondary" size="sm" onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
          </View>
        </View>
      }
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

function Badge({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
      <Text style={[type.footnote, { fontWeight: '500', color: c.ink2 }]}>{children}</Text>
    </View>
  );
}

/** One wine as a row in a grouped list: thumbnail, name, what you have or tasted, and its price. Tap to open. */
function WineEntry({ g, mode, first, last, open, onToggle, onChanged }: {
  g: Group; mode: Mode; first: boolean; last: boolean; open: boolean; onToggle: () => void; onChanged: () => Promise<void>;
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

  return (
    <View
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
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${summary}${market ? `, now ${dollars(market)}` : ''}${g.rating != null ? `, rated ${g.rating}` : ''}`}
        onPress={onToggle}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.rowPhoto, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
      >
        <WineThumb uri={w.image_url} wineStyle={wineStyleOf(w.colour, w.wine_type)} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.wineTitle, { fontSize: 17, lineHeight: 22, color: c.ink }]} numberOfLines={2}>{name}</Text>
          <Text style={[type.subhead, { color: c.ink2 }]} numberOfLines={1}>{[w.sub_region || w.region, summary].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          {market ? <Text style={[type.figure, { color: c.ink }]}>{dollars(market)}</Text> : <Muted style={{ color: c.ink3 }}>No price</Muted>}
          {mode === 'cellar' && change !== null ? (
            <PriceDelta change={change} />
          ) : g.rating != null ? (
            <Rating value={g.rating} />
          ) : null}
        </View>
        <ChevronIcon color={c.ink3} direction={open ? 'up' : 'down'} />
      </Pressable>

      {open ? (
        <View style={{ gap: space[4], paddingHorizontal: space[4], paddingBottom: space[4] }}>
          {mode === 'cellar' ? (
            <Section title="In the cellar">
              {g.cellar.map((t) => <CellarRow key={t.tasting_id} t={t} onChanged={onChanged} />)}
            </Section>
          ) : g.cellar.length ? (
            <Muted>
              In your cellar: {g.bottles} {g.bottles === 1 ? 'bottle' : 'bottles'} ({vintages.join(', ')})
            </Muted>
          ) : null}
          <Section title={mode === 'cellar' ? 'Your tasting notes' : 'Tastings'}>
            {(mode === 'cellar' ? g.tasted : g.notes).length
              ? (mode === 'cellar' ? g.tasted : g.notes).map((t) => <TastingRow key={t.tasting_id} t={t} onChanged={onChanged} />)
              : <Muted>Not tasted yet.</Muted>}
          </Section>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button title="Log tasting" variant="tinted" size="sm" onPress={() => router.push(`/wine/${g.wineId}?add=tasted&vintage=${encodeURIComponent(firstVintage)}`)} />
            <Button title="Add bottles" variant="secondary" size="sm" onPress={() => router.push(`/wine/${g.wineId}?add=cellar&vintage=${encodeURIComponent(firstVintage)}`)} />
            <Button title="Wine page" variant="secondary" size="sm" onPress={() => router.push(`/wine/${g.wineId}`)} icon={(fg) => <ChevronIcon color={fg} size={14} />} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Label>{title}</Label>
      {children}
    </View>
  );
}

/** Pick a new date for an entry, then save it. */
function DateEdit({ t, onChanged, label }: { t: Tasting; onChanged: () => Promise<void>; label: string }) {
  const api = useApi();
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(t.tasted_on);
  const [error, setError] = useState<unknown>(null);
  if (!editing) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${shortDate(t.tasted_on)}, change date`} onPress={() => setEditing(true)} hitSlop={6}>
        <Text style={[type.footnote, { color: c.ink2 }]}>
          {label} {shortDate(t.tasted_on)} <Text style={{ color: c.accent, fontWeight: '600' }}>· Change</Text>
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: space[2] }}>
      <DateField label={label} value={date} onChange={setDate} />
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button
          title="Save date"
          variant="tinted"
          size="sm"
          onPress={async () => {
            try {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a date like 2026-03-07');
              await api.updateTasting(t.tasting_id, { tastedOn: date });
              setEditing(false);
              await onChanged();
            } catch (e) {
              setError(e);
            }
          }}
        />
        <Button title="Cancel" variant="secondary" size="sm" onPress={() => { setDate(t.tasted_on); setEditing(false); }} />
      </View>
      <ErrorText error={error} />
    </View>
  );
}

function CellarRow({ t, onChanged }: { t: Tasting; onChanged: () => Promise<void> }) {
  const api = useApi();
  const { c } = useTheme();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e);
    }
  };
  const n = t.bottles ?? 1;
  return (
    <View style={{ gap: 6, paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1, flexWrap: 'wrap' }}>
          <Text style={[type.headline, type.tabular, { color: c.ink }]}>{t.vintage_key ?? 'NV'}</Text>
          <Badge>{`${n} ${n === 1 ? 'bottle' : 'bottles'}`}</Badge>
          {t.paid_750_cents ? <Muted style={type.tabular}>paid {dollars(t.price_paid_cents)}</Muted> : null}
          <PriceDelta paid={t.paid_750_cents} now={t.market_now_cents} percentOnly />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <Button title="−" variant="secondary" size="sm" accessibilityLabel="One bottle fewer" onPress={() => run(() => (n > 1 ? api.updateTasting(t.tasting_id, { bottles: n - 1 }) : Promise.resolve()))} />
          <Button title="+" variant="secondary" size="sm" accessibilityLabel="One bottle more" onPress={() => run(() => api.updateTasting(t.tasting_id, { bottles: n + 1 }))} />
        </View>
      </View>
      <DateEdit t={t} onChanged={onChanged} label="Added" />
      {t.rating != null || t.notes ? <Muted>{[t.rating != null ? `Rated ${t.rating}` : '', t.notes].filter(Boolean).join(' · ')}</Muted> : null}
      <Button
        title="Remove from cellar"
        variant="plain"
        size="sm"
        style={{ paddingHorizontal: 0 }}
        onPress={async () => {
          const ok = await confirm(
            'Remove from your cellar?',
            `${t.vintage_key ?? 'NV'}, ${n} ${n === 1 ? 'bottle' : 'bottles'}. Your tastings of this wine stay in My tastings.`,
            'Remove'
          );
          if (ok) await run(() => api.removeFromCellar(t.tasting_id));
        }}
      />
      <ErrorText error={error} />
    </View>
  );
}

const SETTING_LABEL = { home: 'At home', restaurant: 'Restaurant', other: 'Elsewhere' } as const;

function TastingRow({ t, onChanged }: { t: Tasting; onChanged: () => Promise<void> }) {
  const api = useApi();
  const { c } = useTheme();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <View style={{ gap: 6, paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
        <Text style={[type.headline, type.tabular, { color: c.ink }]}>{t.vintage_key ?? 'NV'}</Text>
        {t.kind === 'cellar' ? <Badge>{`Cellar · ${t.bottles ?? 1}`}</Badge> : t.setting ? <Badge>{SETTING_LABEL[t.setting]}</Badge> : null}
        {t.price_paid_cents ? <Muted style={type.tabular}>{dollars(t.price_paid_cents)}{t.price_context === 'restaurant' ? ' (restaurant)' : ''}</Muted> : null}
      </View>
      <DateEdit t={t} onChanged={onChanged} label={t.kind === 'cellar' ? 'Added' : 'Tasted'} />
      <Rating value={t.rating} size="md" onChange={(rating) => run(() => api.updateTasting(t.tasting_id, { rating }))} showValue />
      {t.notes ? <Text style={[type.body, { color: c.ink }]}>{t.notes}</Text> : null}
      {t.tags?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {t.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
        </View>
      ) : null}
      {t.kind === 'cellar' ? (
        <Muted>Rated when added to your cellar. The bottles are managed in My cellar.</Muted>
      ) : (
        <Button
          title="Delete tasting"
          variant="plain"
          size="sm"
          style={{ paddingHorizontal: 0 }}
          onPress={async () => {
            if (await confirm('Delete this tasting?', `${shortDate(t.tasted_on)}${t.rating != null ? `, rated ${t.rating}` : ''}. This can't be undone.`, 'Delete')) {
              await run(() => api.deleteTasting(t.tasting_id));
            }
          }}
        />
      )}
      <ErrorText error={error} />
    </View>
  );
}

/** Pick a Vivino export (CSV) and import its ratings. */
function VivinoImport({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function pick() {
    setError(null);
    setResult(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const csv = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
      const summary = await api.importVivino(csv);
      setResult(summary);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Heading>Import from Vivino</Heading>
      <Muted>
        Request a copy of your data from Vivino (in the app&apos;s account or privacy settings), then pick the wine list CSV from the download. Ratings, reviews and dates come across; importing the same file again adds nothing.
      </Muted>
      <Button title="Choose Vivino CSV" variant="secondary" size="md" busy={busy} onPress={pick} />
      {result ? (
        <View style={{ gap: 4 }}>
          <Text style={[type.subhead, { fontWeight: '600', color: c.positive }]}>
            Imported {result.imported} {result.imported === 1 ? 'wine' : 'wines'}
            {result.alreadyImported ? ` · ${result.alreadyImported} already here` : ''}
          </Text>
          <Muted>
            {result.matched} matched to our catalog{result.addedWines ? `, ${result.addedWines} added as new wines` : ''}.
          </Muted>
          {result.addedNames.length ? <Muted>New: {result.addedNames.slice(0, 5).join(' · ')}{result.addedNames.length > 5 ? ' …' : ''}</Muted> : null}
          {result.missingColumns.includes('rating') ? <Muted style={{ color: c.negative }}>No rating column found, so wines came in unrated.</Muted> : null}
        </View>
      ) : null}
      <ErrorText error={error} />
    </Card>
  );
}
