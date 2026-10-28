/** Wines picked from the user's ratings. Nothing is suggested until there are enough ratings to be personal. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../../components/Glass';
import { SparkleIcon } from '../../components/icons';
import { WinePhoto } from '../../components/WineThumb';
import { Button, Card, ErrorText, Heading, Muted, Segmented, Title, radius, space, type, useTheme, wineStyleOf } from '../../components/ui';
import { dollars } from '../../lib/format';
import type { Recommendation } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Filter = 'all' | 'value' | 'red' | 'white' | 'other';

export default function Recommendations() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<{ mode: 'profile'; items: Recommendation[] } | { mode: 'locked'; rated: number; needed: number; items: [] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.recommendations({ bestValue: filter === 'value', colour: filter === 'red' || filter === 'white' || filter === 'other' ? filter : undefined }));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api, filter]);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120, gap: space[5] }}
      columnWrapperStyle={{ gap: space[3] }}
      numColumns={2}
      data={data?.items ?? []}
      keyExtractor={(r) => String(r.wineId)}
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
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Segmented
                small
                options={[{ key: 'all', label: 'All' }, { key: 'value', label: 'Best value' }, { key: 'red', label: 'Red' }, { key: 'white', label: 'White' }, { key: 'other', label: 'Other' }]}
                value={filter}
                onChange={setFilter}
              />
            </View>
          )}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={data?.mode === 'profile' ? <Muted style={type.subhead}>Nothing matches this filter yet.</Muted> : null}
      renderItem={({ item: r }) => <WineCard r={r} />}
    />
  );
}

/** Photo-first tile: the bottle, its price in a glass chip, the name and why it was picked. */
function WineCard({ r }: { r: Recommendation }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.displayName}, ${dollars(r.medianCents)}. ${r.reasons[0] ?? ''}`}
      onPress={() => router.push(`/wine/${r.wineId}`)}
      style={({ pressed }) => [{ flex: 1, maxWidth: '50%', gap: space[2] }, pressed && { opacity: 0.8 }]}
    >
      <WinePhoto uri={r.imageUrl} wineStyle={wineStyleOf(r.colour, r.wineType)} padding={space[3]} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md }}>
        <View style={{ position: 'absolute', left: space[2], bottom: space[2] }}>
          <Glass style={{ borderRadius: radius.pill }}>
            <Text style={[type.subhead, type.tabular, { fontWeight: '700', color: c.ink, paddingVertical: 5, paddingHorizontal: space[3] }]}>{dollars(r.medianCents)}</Text>
          </Glass>
        </View>
      </WinePhoto>
      <View style={{ gap: 2, paddingHorizontal: 2 }}>
        <Text style={[type.wineTitle, { fontSize: 17, lineHeight: 21, color: c.ink }]} numberOfLines={2}>{r.displayName}</Text>
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
  );
}
