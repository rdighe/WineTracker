/** Wine: market price (all vintages or one), price by vintage, where to buy, save, log a tasting. */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BackIcon, BookmarkIcon } from '../../components/icons';
import { TastingForm, type TastingKind } from '../../components/TastingForm';
import { WineAbout, useWineInfo } from '../../components/WineAbout';
import { WineThumb } from '../../components/WineThumb';
import { Button, Card, ErrorText, Eyebrow, IconButton, Mono, Muted, Screen, colors, fonts } from '../../components/ui';
import { dollarsExact as dollars, wineTitle } from '../../lib/format';
import type { PriceSummary, PricesResponse, Wine } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export default function WineScreen() {
  // add=cellar|tasted (and vintage): open the form straight away, from My Cellar / My Tastings.
  const { id, add, vintage: addVintage } = useLocalSearchParams<{ id: string; add?: string; vintage?: string }>();
  const wineId = Number(id);
  const api = useApi();
  const [wine, setWine] = useState<Wine | null>(null);
  const [summaries, setSummaries] = useState<PriceSummary[]>([]);
  const [vintage, setVintage] = useState<string | null>(null);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logging, setLogging] = useState<TastingKind | null>(add === 'cellar' || add === 'tasted' ? add : null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [allVintages, setAllVintages] = useState(false);
  const about = useWineInfo(wineId);

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
    setMessage(null);
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

  async function save() {
    try {
      await api.saveWine(wineId);
      setSaved(true);
      setMessage('Saved to your watch list');
    } catch (e) {
      setError(e);
    }
  }

  const title = wine ? wineTitle(wine.display_name, wine.sub_region) : '';
  const byVintage = summaries.filter((s) => s.vintage_key !== '*').sort((a, b) => b.vintage_key.localeCompare(a.vintage_key));
  const max = Math.max(1, ...byVintage.map((s) => s.median_cents));
  const summary = prices?.summary;
  const span = summary ? summary.p90_cents - summary.p10_cents : 0;
  const marker = summary && span > 0 ? Math.min(1, Math.max(0, (summary.median_cents - summary.p10_cents) / span)) : 0.5;

  return (
    <Screen tabBar={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <BackIcon color={colors.text} />
        </IconButton>
        <IconButton label="Save to watch list" onPress={save}>
          <BookmarkIcon color={colors.accent} filled={saved} />
        </IconButton>
      </View>

      {wine?.image_url ? (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <WineThumb uri={wine.image_url} width={150} height={210} radius={22} />
          {wine.image_match === 'producer' ? <Muted style={{ fontSize: 11 }}>Photo of another wine from this producer</Muted> : null}
        </View>
      ) : null}
      {wine && (
        <View style={{ gap: 6 }}>
          <Eyebrow>{[wine.sub_region, wine.region, wine.country].filter(Boolean).slice(0, 2).join(' · ')}</Eyebrow>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: colors.text }}>{title}</Text>
          <Mono style={{ fontSize: 11, color: colors.muted }}>{[wine.lwin && `LWIN ${wine.lwin}`, capitalize(wine.colour), wine.grape].filter(Boolean).join(' · ')}</Mono>
        </View>
      )}

      <Card style={{ paddingHorizontal: 20, gap: 10 }}>
        <Eyebrow>{vintage ?? 'All vintages'}</Eyebrow>
        {summary ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Mono style={{ fontFamily: fonts.monoMedium, fontSize: 30, color: colors.gold }}>{dollars(summary.median_cents)}</Mono>
              <Muted style={{ fontSize: 12 }}>median · {summary.n_observations} {summary.n_observations === 1 ? 'offer' : 'offers'}</Muted>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line2, marginTop: 4 }}>
              <View style={{ position: 'absolute', left: `${marker * 100}%`, top: -4, width: 2, height: 14, borderRadius: 1, backgroundColor: colors.gold }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Mono style={{ fontSize: 11, color: colors.muted }}>{dollars(summary.p10_cents)} low</Mono>
              <Mono style={{ fontSize: 11, color: colors.muted }}>{dollars(summary.p90_cents)} high</Mono>
            </View>
            {summary.out_of_stock_only ? <Muted style={{ fontSize: 12 }}>Out of stock everywhere: this is what shops listed it at.</Muted> : null}
            {summary.window_days > 30 ? <Muted style={{ fontSize: 12 }}>Based on the last year (nothing more recent).</Muted> : null}
          </>
        ) : (
          <Muted>{prices ? 'No current retail price.' : ' '}</Muted>
        )}
      </Card>

      {byVintage.length > 0 && (
        <Card style={{ paddingHorizontal: 20, gap: 12 }}>
          <Eyebrow>By vintage</Eyebrow>
          {(allVintages ? byVintage : byVintage.slice(0, 8)).map((s) => {
            const on = s.vintage_key === vintage;
            return (
              <Pressable
                key={s.vintage_key}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${s.vintage_key}, ${dollars(s.median_cents)}`}
                onPress={() => setVintage(on ? null : s.vintage_key)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 24 }}
              >
                <Mono style={{ width: 44, fontSize: 12, color: on ? colors.gold : colors.text2 }}>{s.vintage_key}</Mono>
                <View style={{ flex: 1 }}>
                  <View
                    style={{
                      height: 8, borderRadius: 4, width: `${(s.median_cents / max) * 100}%`, backgroundColor: on ? colors.gold : colors.line2,
                      ...(on ? { shadowColor: colors.gold, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } } : {}),
                    }}
                  />
                </View>
                <Mono style={{ width: 72, textAlign: 'right', fontSize: 12, color: on ? colors.gold : colors.text }}>{dollars(s.median_cents)}</Mono>
              </Pressable>
            );
          })}
          {byVintage.length > 8 ? (
            <Button title={allVintages ? 'Show fewer' : `Show all ${byVintage.length} vintages`} variant="pill" style={{ borderColor: colors.line2 }} onPress={() => setAllVintages(!allVintages)} />
          ) : null}
        </Card>
      )}

      <WineAbout res={about} />

      {prices && prices.offers.length > 0 && (
        <Card style={{ paddingHorizontal: 20, gap: 4 }}>
          <Eyebrow>Where to buy</Eyebrow>
          {prices.offers.slice(0, 8).map((o, i) => (
            <Pressable
              key={o.url + o.observed_at}
              accessibilityRole="link"
              onPress={() => o.url.startsWith('http') && Linking.openURL(o.url)}
              style={({ pressed }) => [{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: colors.line }, pressed && { opacity: 0.6 }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.text }} numberOfLines={1}>{o.merchant ?? 'Shop'}</Text>
                <Mono style={{ fontSize: 13, color: colors.gold }}>{dollars(o.price_cents)}</Mono>
              </View>
              <Mono style={{ fontSize: 11, color: colors.muted }}>
                {[o.vintage_key, o.bottle_ml !== 750 ? `${o.bottle_ml} ml` : null, o.in_stock === false ? 'out of stock' : null].filter(Boolean).join(' · ') || ' '}
              </Mono>
            </Pressable>
          ))}
        </Card>
      )}

      {message ? <Muted>{message}</Muted> : null}
      <ErrorText error={error} />

      {logging ? (
        <TastingForm key={logging} wineId={wineId} vintage={vintage ?? (addVintage || null)} kind={logging} suggestedTags={about?.info?.descriptors} onSaved={(k) => { setLogging(null); setMessage(k === 'cellar' ? 'Added to your cellar' : 'Tasting saved'); }} />
      ) : (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Add to cellar" onPress={() => setLogging('cellar')} style={{ flex: 1 }} />
            <Button title="Log tasting" onPress={() => setLogging('tasted')} style={{ flex: 1 }} />
          </View>
          <Button title="Refresh prices" variant="secondary" busy={busy} onPress={refresh} />
        </View>
      )}
    </Screen>
  );
}
