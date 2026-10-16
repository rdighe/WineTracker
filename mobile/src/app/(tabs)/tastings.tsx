/** My wines: bottles in the cellar and wines tasted elsewhere, what was paid and what they're worth now. */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { WineThumb } from '../../components/WineThumb';
import { Button, Card, ErrorText, Eyebrow, Mono, Muted, RatingDots, Segmented, Title, colors, fonts, styles, useScreenPadding } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { dollars, dollarsExact, wineTitle } from '../../lib/format';
import type { ImportSummary, Tasting } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Sort = 'recent' | 'value' | 'rating';
type Show = 'all' | 'cellar' | 'tasted';

const change = (t: Tasting) => (t.paid_750_cents && t.market_now_cents ? (t.market_now_cents - t.paid_750_cents) / t.paid_750_cents : null);

export default function MyWines() {
  const api = useApi();
  const padding = useScreenPadding();
  const params = useLocalSearchParams<{ show?: Show }>();
  const { label, signOut } = useAuth();
  const [items, setItems] = useState<Tasting[] | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [showPicked, setShow] = useState<Show | null>(null);
  const show: Show = showPicked ?? (params.show === 'cellar' || params.show === 'tasted' ? params.show : 'all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await api.tastings()).tastings);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const visible = useMemo(() => {
    const list = (items ?? []).filter((t) => show === 'all' || t.kind === show);
    if (sort === 'value') list.sort((a, b) => (change(b) ?? -Infinity) - (change(a) ?? -Infinity));
    if (sort === 'rating') list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    return list;
  }, [items, sort, show]);

  // Totals over the visible entries that have both a price paid and a market price now (cellar: per bottle x bottles).
  const n = (t: Tasting) => (t.kind === 'cellar' ? t.bottles ?? 1 : 1);
  const priced = visible.filter((t) => t.paid_750_cents && t.market_now_cents);
  const paid = priced.reduce((s, t) => s + t.paid_750_cents! * n(t), 0);
  const worth = priced.reduce((s, t) => s + t.market_now_cents! * n(t), 0);
  const pct = paid ? ((worth - paid) / paid) * 100 : 0;
  const bottles = visible.filter((t) => t.kind === 'cellar').reduce((s, t) => s + (t.bottles ?? 1), 0);

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={padding}
      data={visible}
      keyExtractor={(t) => String(t.tasting_id)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <View>
            <Eyebrow>{items ? `${visible.length} ${visible.length === 1 ? 'wine' : 'wines'}${bottles ? ` · ${bottles} ${bottles === 1 ? 'bottle' : 'bottles'} in the cellar` : ''}` : ' '}</Eyebrow>
            <Title style={{ marginTop: 4 }}>My wines</Title>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <Segmented small options={[{ key: 'all', label: 'All' }, { key: 'cellar', label: 'Cellar' }, { key: 'tasted', label: 'Tasted' }]} value={show} onChange={setShow} />
            <Segmented small options={[{ key: 'recent', label: 'Recent' }, { key: 'value', label: 'Value' }, { key: 'rating', label: 'Rating' }]} value={sort} onChange={setSort} />
          </View>
          {priced.length > 0 && (
            <Card style={{ flexDirection: 'row', paddingHorizontal: 20 }}>
              <Stat label={show === 'cellar' ? 'Cost' : 'You paid'} value={dollars(paid)} />
              <Stat label={show === 'cellar' ? 'Value now' : 'Worth now'} value={dollars(worth)} gold />
              <Stat label="Change" value={`${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`} gold={pct >= 0} />
            </Card>
          )}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={
        items ? (
          <Muted>{show === 'cellar' ? 'No bottles in your cellar yet. Scan one and choose "In my cellar".' : 'Nothing here yet. Scan a label to log your first wine.'}</Muted>
        ) : null
      }
      renderItem={({ item: t }) => <WineRow t={t} onRate={async (rating) => { await api.updateTasting(t.tasting_id, { rating }); await load(); }} />}
      ListFooterComponent={
        <View style={{ marginTop: 8, gap: 16 }}>
          <VivinoImport onDone={load} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Muted>Signed in as {label}</Muted>
            <Button title="Sign out" variant="pill" style={{ borderColor: colors.line2 }} onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
          </View>
        </View>
      }
    />
  );
}

const SETTING_LABEL = { home: 'AT HOME', restaurant: 'RESTAURANT', other: 'ELSEWHERE' } as const;

function Badge({ children }: { children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: colors.line2 }}>
      <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.text2 }}>{children}</Text>
    </View>
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

function WineRow({ t, onRate }: { t: Tasting; onRate: (rating: number) => Promise<void> }) {
  const [rating, setRating] = useState<number | null | undefined>(undefined);
  const anyVintage = t.market_vintage_key === '*' && t.vintage_key;
  // The card opens the wine; "Rate it" sits outside that tap target (a button can't contain another).
  return (
    <Card style={{ marginBottom: 12, padding: 16, gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/wine/${t.wine_id}`)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14 }, pressed && { opacity: 0.7 }]}
      >
        <WineThumb uri={t.image_url} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text }} numberOfLines={2}>{wineTitle(t.display_name, t.sub_region)}</Text>
            {t.vintage_key ? <Mono style={{ color: colors.gold }}>{t.vintage_key}</Mono> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {t.sub_region || t.region ? <Muted style={{ fontSize: 12, flexShrink: 1 }}>{t.sub_region || t.region}</Muted> : null}
            {t.kind === 'cellar' ? <Badge>CELLAR · {t.bottles ?? 1}</Badge> : t.setting ? <Badge>{SETTING_LABEL[t.setting]}</Badge> : null}
          </View>
          <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            {t.paid_750_cents && t.market_now_cents && !anyVintage ? (
              <Mono style={{ fontSize: 12 }}>
                {dollars(t.paid_750_cents)} → <Text style={{ color: colors.gold }}>{dollarsExact(t.market_now_cents)}</Text>
              </Mono>
            ) : t.market_now_cents ? (
              <Muted style={{ fontSize: 12, flex: 1 }}>
                {anyVintage ? `No ${t.vintage_key} offers · all vintages ` : 'Now '}
                <Text style={{ fontFamily: fonts.mono, color: colors.text2 }}>{dollarsExact(t.market_now_cents)}</Text>
              </Muted>
            ) : (
              <Muted style={{ fontSize: 12 }}>No market price yet</Muted>
            )}
            {t.rating != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />
                <Mono style={{ fontSize: 12, color: colors.text }}>{t.rating}</Mono>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      {t.rating == null && rating === undefined ? (
        <Button title="Rate it" variant="pill" style={{ marginLeft: 62 }} onPress={() => setRating(null)} />
      ) : null}
      {t.rating == null && rating !== undefined ? (
        <View style={{ marginLeft: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <RatingDots value={rating} onChange={setRating} size={20} />
          {rating != null ? <Button title="Save" variant="pill" onPress={() => onRate(rating)} /> : null}
        </View>
      ) : null}
    </Card>
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
