/** Wines picked from the user's ratings (or popular wines until they've rated a few). */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Card, ErrorText, Muted, colors, styles } from '../../components/ui';
import { dollars } from '../../lib/format';
import type { Recommendation } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'value', label: 'Best value' },
  { key: 'red', label: 'Red' },
  { key: 'white', label: 'White' },
] as const;

export default function Recommendations() {
  const api = useApi();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
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
      contentContainerStyle={styles.content}
      data={data?.items ?? []}
      keyExtractor={(r) => String(r.wineId)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {FILTERS.map((f) => (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: filter === f.key ? colors.wine : colors.wineLight }}>
                <Text style={{ color: filter === f.key ? '#fff' : colors.wine }}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          {data?.mode === 'popular' && <Muted>Rate a few wines and these become personal. For now: wines the most shops carry.</Muted>}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={data ? <Muted>Nothing to suggest yet.</Muted> : null}
      renderItem={({ item: r }) => (
        <Pressable onPress={() => router.push(`/wine/${r.wineId}`)}>
          <Card>
            <Text style={styles.h2}>{r.displayName}</Text>
            <Muted>{[r.region, r.country].filter(Boolean).join(', ')}</Muted>
            <Text style={{ color: colors.text }}>{dollars(r.medianCents)} typical · {r.nMerchants} {r.nMerchants === 1 ? 'shop' : 'shops'}</Text>
            {r.reasons.map((reason) => (
              <Text key={reason} style={{ color: colors.wine }}>{reason}</Text>
            ))}
          </Card>
        </Pressable>
      )}
    />
  );
}
