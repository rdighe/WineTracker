/** Cellar: wines you've tasted, what you paid, and what they're worth now. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { GlassIcon } from '../../components/icons';
import { Button, Card, ErrorText, Eyebrow, Mono, Muted, RatingDots, Segmented, Title, colors, fonts, styles, useScreenPadding } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { dollars, dollarsExact, wineTitle } from '../../lib/format';
import type { Tasting } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Sort = 'recent' | 'value' | 'rating';

const change = (t: Tasting) => (t.paid_750_cents && t.market_now_cents ? (t.market_now_cents - t.paid_750_cents) / t.paid_750_cents : null);

export default function Cellar() {
  const api = useApi();
  const padding = useScreenPadding();
  const { label, signOut } = useAuth();
  const [items, setItems] = useState<Tasting[] | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
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

  const sorted = useMemo(() => {
    const list = [...(items ?? [])];
    if (sort === 'value') list.sort((a, b) => (change(b) ?? -Infinity) - (change(a) ?? -Infinity));
    if (sort === 'rating') list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    return list;
  }, [items, sort]);

  // Totals over tastings with both a price paid and a market price now.
  const priced = (items ?? []).filter((t) => t.paid_750_cents && t.market_now_cents);
  const paid = priced.reduce((s, t) => s + t.paid_750_cents!, 0);
  const worth = priced.reduce((s, t) => s + t.market_now_cents!, 0);
  const pct = paid ? ((worth - paid) / paid) * 100 : 0;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={padding}
      data={sorted}
      keyExtractor={(t) => String(t.tasting_id)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Eyebrow>{items ? `${items.length} ${items.length === 1 ? 'wine' : 'wines'}` : ' '}</Eyebrow>
              <Title style={{ marginTop: 4 }}>Cellar</Title>
            </View>
            <Segmented
              small
              options={[{ key: 'recent', label: 'Recent' }, { key: 'value', label: 'Value' }, { key: 'rating', label: 'Rating' }]}
              value={sort}
              onChange={setSort}
            />
          </View>
          {priced.length > 0 && (
            <Card style={{ flexDirection: 'row', paddingHorizontal: 20 }}>
              <Stat label="You paid" value={dollars(paid)} />
              <Stat label="Worth now" value={dollars(worth)} gold />
              <Stat label="Change" value={`${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`} gold={pct >= 0} />
            </Card>
          )}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={items ? <Muted>No tastings yet. Scan a label to log your first wine.</Muted> : null}
      renderItem={({ item: t }) => <CellarRow t={t} onRate={async (rating) => { await api.updateTasting(t.tasting_id, { rating }); await load(); }} />}
      ListFooterComponent={
        <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Muted>Signed in as {label}</Muted>
          <Button title="Sign out" variant="pill" style={{ borderColor: colors.line2 }} onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
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

function CellarRow({ t, onRate }: { t: Tasting; onRate: (rating: number) => Promise<void> }) {
  const [rating, setRating] = useState<number | null | undefined>(undefined);
  const anyVintage = t.market_vintage_key === '*' && t.vintage_key;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/wine/${t.wine_id}`)} style={({ pressed }) => [{ marginBottom: 12 }, pressed && { opacity: 0.7 }]}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
        <View style={{ width: 48, height: 64, borderRadius: 12, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' }}>
          <GlassIcon color={colors.faint} size={20} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text }} numberOfLines={2}>{wineTitle(t.display_name, t.sub_region)}</Text>
            {t.vintage_key ? <Mono style={{ color: colors.gold }}>{t.vintage_key}</Mono> : null}
          </View>
          {t.sub_region || t.region ? <Muted style={{ fontSize: 12 }}>{t.sub_region || t.region}</Muted> : null}
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
          {t.rating == null && rating === undefined ? (
            <Button title="Rate it" variant="pill" style={{ marginTop: 6 }} onPress={() => setRating(null)} />
          ) : null}
          {t.rating == null && rating !== undefined ? (
            <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <RatingDots value={rating} onChange={setRating} size={20} />
              {rating != null ? <Button title="Save" variant="pill" onPress={() => onRate(rating)} /> : null}
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}
