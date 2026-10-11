/** My tastings: rating, what I paid, and the market price now. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, Card, ErrorText, Muted, colors, styles } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { dollars, priceChange, stars } from '../../lib/format';
import type { Tasting } from '../../lib/types';
import { useApi } from '../../lib/useApi';

export default function Tastings() {
  const api = useApi();
  const { label, signOut } = useAuth();
  const [items, setItems] = useState<Tasting[] | null>(null);
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

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={items ?? []}
      keyExtractor={(t) => String(t.tasting_id)}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      ListHeaderComponent={<ErrorText error={error} />}
      ListEmptyComponent={items ? <Muted>No tastings yet. Scan a label to log your first wine.</Muted> : null}
      renderItem={({ item: t }) => {
        const change = priceChange(t.paid_750_cents, t.market_now_cents);
        return (
          <Pressable onPress={() => router.push(`/wine/${t.wine_id}`)}>
            <Card>
              <Text style={styles.h2}>{t.display_name}{t.vintage_key ? ` ${t.vintage_key}` : ''}</Text>
              <Text style={{ color: colors.wine }}>{stars(t.rating)}</Text>
              <View style={styles.row}>
                <Muted>{t.tasted_on}</Muted>
                {t.paid_750_cents ? <Muted>· paid {dollars(t.paid_750_cents)}{t.price_context === 'restaurant' ? ' (restaurant)' : ''}</Muted> : null}
              </View>
              <Muted>
                Market now: {dollars(t.market_now_cents)}
                {t.market_vintage_key === '*' && t.vintage_key ? ' (any vintage)' : ''}
                {change ? `  ${change} vs paid` : ''}
              </Muted>
              {t.notes ? <Text>{t.notes}</Text> : null}
              {t.tags.length ? <Muted>{t.tags.join(' · ')}</Muted> : null}
            </Card>
          </Pressable>
        );
      }}
      ListFooterComponent={
        <View style={{ marginTop: 24, gap: 6 }}>
          <Muted>Signed in as {label}</Muted>
          <Button title="Sign out" variant="secondary" onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
        </View>
      }
    />
  );
}
