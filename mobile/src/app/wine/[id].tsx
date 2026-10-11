/** Wine detail: market price by vintage, recent shop offers, refresh, save, log a tasting. */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { TastingForm } from '../../components/TastingForm';
import { Button, Card, ErrorText, Muted, colors, styles } from '../../components/ui';
import { dollars } from '../../lib/format';
import type { PriceSummary, PricesResponse, Wine } from '../../lib/types';
import { useApi } from '../../lib/useApi';

export default function WineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wineId = Number(id);
  const api = useApi();
  const [wine, setWine] = useState<Wine | null>(null);
  const [summaries, setSummaries] = useState<PriceSummary[]>([]);
  const [vintage, setVintage] = useState<string | null>(null);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await api.wine(wineId);
        const p = await api.prices(wineId, vintage);
        if (cancelled) return;
        setWine(w.wine);
        setSummaries(w.prices);
        setPrices(p);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, wineId, vintage, reloadKey]);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await api.refreshPrices(wineId, vintage);
      setReloadKey((k) => k + 1);
      setMessage('Prices updated');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const vintages = summaries.map((s) => s.vintage_key).filter((v) => v !== '*');
  const summary = prices?.summary;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: wine?.producer || 'Wine' }} />
      {wine && (
        <Card>
          <Text style={styles.title}>{wine.display_name}</Text>
          <Muted>{[wine.sub_region, wine.region, wine.country].filter(Boolean).join(', ')}</Muted>
          {wine.grape ? <Muted>{wine.grape}</Muted> : null}
        </Card>
      )}
      {vintages.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[null, ...vintages].map((v) => (
            <Pressable key={v ?? 'all'} onPress={() => setVintage(v)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: vintage === v ? colors.wine : colors.wineLight }}>
              <Text style={{ color: vintage === v ? '#fff' : colors.wine }}>{v ?? 'All vintages'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Card>
        <Text style={styles.h2}>Market price{vintage ? ` · ${vintage}` : ''}</Text>
        {summary ? (
          <>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.wine }}>{dollars(summary.median_cents)}</Text>
            <Muted>
              Range {dollars(summary.p10_cents)}–{dollars(summary.p90_cents)} · {summary.n_merchants} {summary.n_merchants === 1 ? 'shop' : 'shops'} · per 750 ml
            </Muted>
            {summary.window_days > 30 ? <Muted>Based on the last year (nothing more recent).</Muted> : null}
          </>
        ) : (
          <Muted>No current retail price.</Muted>
        )}
        <Button title="Check prices now" variant="secondary" busy={busy} onPress={refresh} />
        {message ? <Muted>{message}</Muted> : null}
      </Card>
      {prices && prices.offers.length > 0 && (
        <Card>
          <Text style={styles.h2}>Where to buy</Text>
          {prices.offers.slice(0, 10).map((o) => (
            <Pressable key={o.url + o.observed_at} onPress={() => o.url.startsWith('http') && Linking.openURL(o.url)} style={{ paddingVertical: 6 }}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={{ color: colors.text, flex: 1 }}>{o.merchant ?? 'Shop'}{o.vintage_key ? ` · ${o.vintage_key}` : ''}{o.bottle_ml !== 750 ? ` · ${o.bottle_ml} ml` : ''}</Text>
                <Text style={{ fontWeight: '600' }}>{dollars(o.price_cents)}</Text>
              </View>
              {o.in_stock === false ? <Muted>Out of stock</Muted> : null}
            </Pressable>
          ))}
        </Card>
      )}
      <ErrorText error={error} />
      <Button title="Save to my list" variant="secondary" onPress={async () => { await api.saveWine(wineId); setMessage('Saved'); }} />
      {logging ? (
        <TastingForm wineId={wineId} vintage={vintage} onSaved={() => { setLogging(false); setMessage('Tasting saved'); }} />
      ) : (
        <Button title="Log a tasting" onPress={() => setLogging(true)} />
      )}
    </ScrollView>
  );
}
