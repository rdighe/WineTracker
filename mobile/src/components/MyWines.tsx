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
import { Alert, FlatList, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { dollars, dollarsExact, shortDate, wineTitle } from '../lib/format';
import type { ImportSummary, Tasting } from '../lib/types';
import { useApi } from '../lib/useApi';
import { DateField } from './DateField';
import { WineFilters, activeCount, applyFilters, type Filters } from './WineFilters';
import { WineThumb } from './WineThumb';
import { Button, Card, Chip, ErrorText, Eyebrow, Mono, Muted, RatingDots, Segmented, Title, colors, fonts, styles, useScreenPadding } from './ui';

export type Mode = 'cellar' | 'tastings';
type Sort = 'recent' | 'value' | 'rating';

interface Group {
  wineId: number;
  wine: Tasting;
  rows: Tasting[];
  cellar: Tasting[];
  tasted: Tasting[];
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
  const padding = useScreenPadding();
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

  const groups = useMemo(() => group(rows ?? []).filter((g) => (mode === 'cellar' ? g.cellar.length > 0 : g.tasted.length > 0)), [rows, mode]);
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
  const pct = paid ? ((worth - paid) / paid) * 100 : 0;
  const bottles = visible.reduce((s, g) => s + g.bottles, 0);
  const eyebrow = mode === 'cellar'
    ? `${visible.length} ${visible.length === 1 ? 'Wine' : 'Wines'} · ${bottles} ${bottles === 1 ? 'Bottle' : 'Bottles'}`
    : `${visible.length} ${visible.length === 1 ? 'Wine' : 'Wines'} Tasted`;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={padding}
      data={visible}
      keyExtractor={(g) => String(g.wineId)}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <View>
            <Eyebrow>{rows ? eyebrow : ' '}</Eyebrow>
            <Title style={{ marginTop: 4 }}>{mode === 'cellar' ? 'My Cellar' : 'My Tastings'}</Title>
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
            <Card style={{ flexDirection: 'row', paddingHorizontal: 20 }}>
              <Stat label="Cost" value={dollars(paid)} />
              <Stat label="Value now" value={dollars(worth)} gold />
              <Stat label="Change" value={`${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`} gold={pct >= 0} />
            </Card>
          )}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={
        rows && narrowed && groups.length ? (
          <View style={{ gap: 10, alignItems: 'flex-start' }}>
            <Muted>No wines match.</Muted>
            <Button title="Clear search and filters" variant="pill" style={{ borderColor: colors.line2 }} onPress={() => { setQuery(''); setFilters({}); }} />
          </View>
        ) : rows ? (
          <Muted>{mode === 'cellar' ? 'No bottles in your cellar yet. Add a wine and choose "In my cellar".' : 'No tastings yet. Add a wine and log what you thought of it.'}</Muted>
        ) : null
      }
      renderItem={({ item: g }) => (
        <WineEntry g={g} mode={mode} open={open === g.wineId} onToggle={() => setOpen(open === g.wineId ? null : g.wineId)} onChanged={load} />
      )}
      ListFooterComponent={
        <View style={{ marginTop: 8, gap: 16 }}>
          {mode === 'tastings' ? <VivinoImport onDone={load} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Muted>Signed in as {label}</Muted>
            <Button title="Sign out" variant="pill" style={{ borderColor: colors.line2 }} onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
          </View>
        </View>
      }
    />
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow>
      <Mono style={{ fontSize: 18, color: gold ? colors.gold : colors.text }}>{value}</Mono>
    </View>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: colors.line2 }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.text2 }}>{children}</Text>
    </View>
  );
}

function WineEntry({ g, mode, open, onToggle, onChanged }: { g: Group; mode: Mode; open: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
  const w = g.wine;
  const vintages = [...new Set(g.cellar.map((t) => t.vintage_key ?? 'NV'))].sort().reverse();
  const market = (mode === 'cellar' ? g.cellar : g.tasted).find((t) => t.market_now_cents)?.market_now_cents ?? null;
  const summary = mode === 'cellar'
    ? `${g.bottles} ${g.bottles === 1 ? 'bottle' : 'bottles'} · ${vintages.join(', ')}`
    : `Tasted ${g.tasted.length === 1 ? 'once' : `${g.tasted.length} times`} · ${shortDate(g.tasted[0]?.tasted_on)}`;
  const firstVintage = (mode === 'cellar' ? g.cellar : g.tasted)[0]?.vintage_key ?? '';

  return (
    <Card style={{ marginBottom: 12, padding: 16, gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14 }, pressed && { opacity: 0.7 }]}
      >
        <WineThumb uri={w.image_url} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.text }} numberOfLines={2}>{wineTitle(w.display_name, w.sub_region)}</Text>
          {w.sub_region || w.region ? <Muted style={{ fontSize: 12 }}>{w.sub_region || w.region}</Muted> : null}
          <Muted style={{ fontSize: 12, color: colors.text2 }}>{summary}</Muted>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            {market ? <Mono style={{ fontSize: 12, color: colors.gold }}>Now {dollarsExact(market)}</Mono> : <Muted style={{ fontSize: 12 }}>No market price yet</Muted>}
            {g.rating != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
                <Mono style={{ fontSize: 12, color: colors.text }}>{g.rating}</Mono>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={{ fontFamily: fonts.mono, fontSize: 16, color: colors.muted }}>{open ? '−' : '+'}</Text>
      </Pressable>

      {open ? (
        <View style={{ gap: 14 }}>
          {mode === 'cellar' ? (
            <Section title="In the cellar">
              {g.cellar.map((t) => <CellarRow key={t.tasting_id} t={t} onChanged={onChanged} />)}
            </Section>
          ) : g.cellar.length ? (
            <Muted style={{ fontSize: 12 }}>
              In your cellar: {g.bottles} {g.bottles === 1 ? 'bottle' : 'bottles'} ({vintages.join(', ')})
            </Muted>
          ) : null}
          <Section title={mode === 'cellar' ? 'Your tasting notes' : 'Tastings'}>
            {g.tasted.length ? g.tasted.map((t) => <TastingRow key={t.tasting_id} t={t} onChanged={onChanged} />) : <Muted style={{ fontSize: 12 }}>Not tasted yet.</Muted>}
          </Section>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button title="+ Tasting" variant="pill" onPress={() => router.push(`/wine/${g.wineId}?add=tasted&vintage=${encodeURIComponent(firstVintage)}`)} />
            <Button title="+ Bottles" variant="pill" style={{ borderColor: colors.line2 }} onPress={() => router.push(`/wine/${g.wineId}?add=cellar&vintage=${encodeURIComponent(firstVintage)}`)} />
            <Button title="Wine page" variant="pill" style={{ borderColor: colors.line2 }} onPress={() => router.push(`/wine/${g.wineId}`)} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow style={{ fontSize: 10 }}>{title}</Eyebrow>
      {children}
    </View>
  );
}

/** Pick a new date for an entry, then save it. */
function DateEdit({ t, onChanged, label }: { t: Tasting; onChanged: () => Promise<void>; label: string }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(t.tasted_on);
  const [error, setError] = useState<unknown>(null);
  if (!editing) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${shortDate(t.tasted_on)}, change date`} onPress={() => setEditing(true)}>
        <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted }}>
          {label} {shortDate(t.tasted_on)} <Text style={{ color: colors.accent }}>· change</Text>
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <DateField label={label} value={date} onChange={setDate} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title="Save date"
          variant="pill"
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
        <Button title="Cancel" variant="pill" style={{ borderColor: colors.line2 }} onPress={() => { setDate(t.tasted_on); setEditing(false); }} />
      </View>
      <ErrorText error={error} />
    </View>
  );
}

function CellarRow({ t, onChanged }: { t: Tasting; onChanged: () => Promise<void> }) {
  const api = useApi();
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
    <View style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: colors.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono style={{ color: colors.gold }}>{t.vintage_key ?? 'NV'}</Mono>
          <Badge>{`${n} ${n === 1 ? 'BOTTLE' : 'BOTTLES'}`}</Badge>
          {t.paid_750_cents ? <Muted style={{ fontSize: 12 }}>paid {dollars(t.price_paid_cents)}</Muted> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Button title="−" variant="pill" style={{ borderColor: colors.line2, minWidth: 34, alignItems: 'center' }} onPress={() => run(() => (n > 1 ? api.updateTasting(t.tasting_id, { bottles: n - 1 }) : Promise.resolve()))} />
          <Button title="+" variant="pill" style={{ borderColor: colors.line2, minWidth: 34, alignItems: 'center' }} onPress={() => run(() => api.updateTasting(t.tasting_id, { bottles: n + 1 }))} />
        </View>
      </View>
      <DateEdit t={t} onChanged={onChanged} label="Added" />
      {t.rating != null || t.notes ? <Muted style={{ fontSize: 12 }}>{[t.rating != null ? `Rated ${t.rating}` : '', t.notes].filter(Boolean).join(' · ')}</Muted> : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          title="Remove from cellar"
          variant="pill"
          style={{ borderColor: colors.line2 }}
          onPress={async () => {
            const ok = await confirm(
              'Remove from your cellar?',
              `${t.vintage_key ?? 'NV'}, ${n} ${n === 1 ? 'bottle' : 'bottles'}. Your tastings of this wine stay in My Tastings.`,
              'Remove'
            );
            if (ok) await run(() => api.removeFromCellar(t.tasting_id));
          }}
        />
      </View>
      <ErrorText error={error} />
    </View>
  );
}

const SETTING_LABEL = { home: 'At home', restaurant: 'Restaurant', other: 'Elsewhere' } as const;

function TastingRow({ t, onChanged }: { t: Tasting; onChanged: () => Promise<void> }) {
  const api = useApi();
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
    <View style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: colors.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Mono style={{ color: colors.gold }}>{t.vintage_key ?? 'NV'}</Mono>
          {t.setting ? <Badge>{SETTING_LABEL[t.setting].toUpperCase()}</Badge> : null}
          {t.price_paid_cents ? <Muted style={{ fontSize: 12 }}>{dollars(t.price_paid_cents)}{t.price_context === 'restaurant' ? ' (restaurant)' : ''}</Muted> : null}
        </View>
      </View>
      <DateEdit t={t} onChanged={onChanged} label="Tasted" />
      <RatingDots value={t.rating} size={20} onChange={(rating) => run(() => api.updateTasting(t.tasting_id, { rating }))} />
      {t.notes ? <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.text2 }}>{t.notes}</Text> : null}
      {t.tags?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {t.tags.map((tag) => <Chip key={tag} tone="tag">{tag}</Chip>)}
        </View>
      ) : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          title="Delete tasting"
          variant="pill"
          style={{ borderColor: colors.line2 }}
          onPress={async () => {
            if (await confirm('Delete this tasting?', `${shortDate(t.tasted_on)}${t.rating != null ? `, rated ${t.rating}` : ''}. This can't be undone.`, 'Delete')) {
              await run(() => api.deleteTasting(t.tasting_id));
            }
          }}
        />
      </View>
      <ErrorText error={error} />
    </View>
  );
}

/** Pick a Vivino export (CSV) and import its ratings. */
function VivinoImport({ onDone }: { onDone: () => void }) {
  const api = useApi();
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
      <Eyebrow>Import from Vivino</Eyebrow>
      <Muted>
        Request a copy of your data from Vivino (in the app&apos;s account or privacy settings), then pick the wine list CSV from the download. Ratings, reviews and dates come across; importing the same file again adds nothing.
      </Muted>
      <Button title="Choose Vivino CSV" variant="secondary" busy={busy} onPress={pick} />
      {result ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.gold }}>
            Imported {result.imported} {result.imported === 1 ? 'wine' : 'wines'}
            {result.alreadyImported ? ` · ${result.alreadyImported} already here` : ''}
          </Text>
          <Muted style={{ fontSize: 12 }}>
            {result.matched} matched to our catalog{result.addedWines ? `, ${result.addedWines} added as new wines` : ''}.
          </Muted>
          {result.addedNames.length ? <Muted style={{ fontSize: 12 }}>New: {result.addedNames.slice(0, 5).join(' · ')}{result.addedNames.length > 5 ? ' …' : ''}</Muted> : null}
          {result.missingColumns.includes('rating') ? <Muted style={{ fontSize: 12, color: colors.error }}>No rating column found, so wines came in unrated.</Muted> : null}
        </View>
      ) : null}
      <ErrorText error={error} />
    </Card>
  );
}
