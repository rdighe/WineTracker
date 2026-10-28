/**
 * Wines picked from the user's ratings, a few of every style they've liked,
 * with filters for each of those styles. Nothing is suggested until there are
 * enough ratings to be personal.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../../components/Glass';
import { SparkleIcon } from '../../components/icons';
import { WinePhoto } from '../../components/WineThumb';
import { Button, Card, Chip, ErrorText, Heading, Muted, Title, radius, space, type, useTheme, wineStyleOf } from '../../components/ui';
import type { WineStyle } from '../../components/theme';
import { dollars } from '../../lib/format';
import type { RecStyle, Recommendation, RecommendationsResponse } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Filter = 'all' | 'value' | RecStyle;

const STYLE_LABEL: Record<RecStyle, string> = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', orange: 'Orange', sweet: 'Sweet & fortified' };
/** The color dot for each style (sweet wines share the fortified color). */
const STYLE_DOT: Record<RecStyle, WineStyle> = { red: 'red', white: 'white', rose: 'rose', sparkling: 'sparkling', orange: 'orange', sweet: 'fortified' };

export default function Recommendations() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  // The styles to offer as filters; kept while a filter is on so the chips don't change under you.
  const [styles, setStyles] = useState<RecStyle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.recommendations(filter === 'all' || filter === 'value' ? { bestValue: filter === 'value' } : { style: filter });
      setData(res);
      if (res.mode === 'profile' && res.styles?.length) setStyles(res.styles);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api, filter]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const filters: { key: Filter; label: string; dot?: WineStyle }[] = [
    { key: 'all', label: 'All' },
    { key: 'value', label: 'Best value' },
    ...styles.map((s) => ({ key: s, label: STYLE_LABEL[s], dot: STYLE_DOT[s] })),
  ];

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120, gap: space[5] }}
      columnWrapperStyle={{ gap: space[3] }}
      numColumns={2}
      data={data?.items ?? []}
      // Each filter's list fades in as a new list.
      key={filter}
      keyExtractor={(r) => `${filter}-${r.wineId}`}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.ink3} />}
      ListHeaderComponent={
        <View style={{ gap: space[4] }}>
          <View>
            <Title>For you</Title>
            <Muted style={{ marginTop: 2 }}>From your ratings</Muted>
          </View>
          {data?.mode === 'locked' ? (
            <Card style={{ gap: 14 }}>
              <SparkleIcon color={c.accent} size={26} />
              <Heading style={type.title2}>
                Rate {data.needed - data.rated} more {data.needed - data.rated === 1 ? 'wine' : 'wines'} to unlock suggestions
              </Heading>
              <Muted style={type.subhead}>Suggestions come from what you like, so we wait until we know a little about your taste.</Muted>
              <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={`${data.rated} of ${data.needed} rated`}>
                {Array.from({ length: data.needed }, (_, i) => (
                  <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < data.rated ? c.accent : c.fillQuiet }} />
                ))}
              </View>
              <Muted style={type.tabular}>{data.rated} of {data.needed} rated</Muted>
              <Button title="Add a wine" onPress={() => router.push('/')} />
            </Card>
          ) : data ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space[4] }} contentContainerStyle={{ gap: space[2], paddingHorizontal: space[4] }}>
              {filters.map((f) => (
                <Chip key={f.key} small dot={f.dot} selected={filter === f.key} onPress={() => setFilter(f.key)}>{f.label}</Chip>
              ))}
            </ScrollView>
          ) : null}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={data?.mode === 'profile' ? (
        <Muted style={type.subhead}>{filter === 'all' || filter === 'value' ? 'Nothing to suggest yet. Rate a few more wines.' : `No ${STYLE_LABEL[filter].toLowerCase()} wines in stock that fit yet.`}</Muted>
      ) : null}
      renderItem={({ item: r, index }) => <WineCard r={r} index={index} />}
    />
  );
}

/** Photo-first tile: the bottle, its price in a glass chip, the name and why it was picked. */
function WineCard({ r, index }: { r: Recommendation; index: number }) {
  const { c } = useTheme();
  const style = r.style ? STYLE_DOT[r.style] : wineStyleOf(r.colour, r.wineType);
  return (
    <Animated.View entering={FadeInDown.duration(280).delay(Math.min(index, 8) * 45)} style={{ flex: 1, maxWidth: '50%' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${r.displayName}, ${dollars(r.medianCents)}. ${r.reasons[0] ?? ''}`}
        onPress={() => router.push(`/wine/${r.wineId}`)}
        style={({ pressed }) => [{ gap: space[2] }, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }]}
      >
        <WinePhoto uri={r.imageUrl} wineStyle={style} padding={space[3]} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md }}>
          <View style={{ position: 'absolute', left: space[2], bottom: space[2] }}>
            <Glass style={{ borderRadius: radius.pill }}>
              <Text style={[type.subhead, type.tabular, { fontWeight: '700', color: c.ink, paddingVertical: 5, paddingHorizontal: space[3] }]}>{dollars(r.medianCents)}</Text>
            </Glass>
          </View>
        </WinePhoto>
        <View style={{ gap: 2, paddingHorizontal: 2 }}>
          <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{r.displayName}</Text>
          <Muted numberOfLines={1}>
            {[r.region, r.country].filter(Boolean).join(' · ')}
            {r.nMerchants ? ` · ${r.nMerchants} ${r.nMerchants === 1 ? 'shop' : 'shops'}` : ''}
          </Muted>
          {r.reasons[0] ? (
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
              <View style={{ marginTop: 2 }}><SparkleIcon color={c.accent} size={13} /></View>
              <Text style={[type.footnote, { flex: 1, color: c.accent }]} numberOfLines={2}>{r.reasons[0]}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
