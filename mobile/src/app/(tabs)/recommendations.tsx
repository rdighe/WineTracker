/** Wines picked from the user's ratings (or popular wines until they've rated a few). */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SparkleIcon } from '../../components/icons';
import { Card, ErrorText, Eyebrow, Mono, Muted, Segmented, Title, colors, fonts, styles, useScreenPadding } from '../../components/ui';
import { dollars } from '../../lib/format';
import type { Recommendation } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Filter = 'all' | 'value' | 'red' | 'white';

export default function Recommendations() {
  const api = useApi();
  const padding = useScreenPadding();
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<{ mode: 'profile' | 'popular'; items: Recommendation[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.recommendations({ bestValue: filter === 'value', colour: filter === 'red' || filter === 'white' ? filter : undefined }));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api, filter]);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={padding}
      data={data?.items ?? []}
      keyExtractor={(r) => String(r.wineId)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.muted} />}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <View>
            <Eyebrow>{data?.mode === 'profile' ? 'From your ratings' : 'Popular right now'}</Eyebrow>
            <Title style={{ marginTop: 4 }}>For you</Title>
          </View>
          <View style={{ alignSelf: 'flex-start' }}>
            <Segmented
              small
              options={[{ key: 'all', label: 'All' }, { key: 'value', label: 'Best value' }, { key: 'red', label: 'Red' }, { key: 'white', label: 'White' }]}
              value={filter}
              onChange={setFilter}
            />
          </View>
          {data?.mode === 'popular' && <Muted>Rate a few wines and these become personal. For now: wines the most shops carry.</Muted>}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={data ? <Muted>Nothing to suggest yet.</Muted> : null}
      renderItem={({ item: r }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/wine/${r.wineId}`)} style={({ pressed }) => [{ marginBottom: 12 }, pressed && { opacity: 0.7 }]}>
          <Card style={{ padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text }}>{r.displayName}</Text>
              <Mono style={{ fontSize: 15, color: colors.gold }}>{dollars(r.medianCents)}</Mono>
            </View>
            <Muted style={{ fontSize: 12 }}>
              {[r.region, r.country].filter(Boolean).join(' · ')}
              {r.nMerchants ? ` · ${r.nMerchants} ${r.nMerchants === 1 ? 'shop' : 'shops'}` : ''}
            </Muted>
            {r.reasons.map((reason) => (
              <View key={reason} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SparkleIcon color={colors.accent} size={14} />
                <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.text2 }}>{reason}</Text>
              </View>
            ))}
          </Card>
        </Pressable>
      )}
    />
  );
}
