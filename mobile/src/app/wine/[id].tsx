/** Wine: the photo first, then market price (all vintages or one), price by vintage, where to buy, save, log a tasting. */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExpandingSheet, measure, type Rect } from '../../components/ExpandingSheet';
import { Glass } from '../../components/Glass';
import { BackIcon, BookmarkIcon, BottleIcon, PlusIcon, RefreshIcon } from '../../components/icons';
import { TastingForm, type TastingKind } from '../../components/TastingForm';
import { WineAbout, useWineInfo } from '../../components/WineAbout';
import { PriceBones, Skeleton, WineSkeleton } from '../../components/Skeleton';
import { WinePhoto } from '../../components/WineThumb';
import { Button, Card, Divider, ErrorText, Heading, IconButton, Muted, StyleDot, radius, size, space, type, useTheme, wineStyleOf } from '../../components/ui';
import { dollars, wineTitle } from '../../lib/format';
import type { PriceSummary, PricesResponse, Wine } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const STYLE_LABEL = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', orange: 'Orange', fortified: 'Fortified' } as const;

export default function WineScreen() {
  // add=cellar|tasted (and vintage): open the form straight away, from My wines.
  const { id, add, vintage: addVintage } = useLocalSearchParams<{ id: string; add?: string; vintage?: string }>();
  const wineId = Number(id);
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c, glass } = useTheme();
  const [wine, setWine] = useState<Wine | null>(null);
  const [summaries, setSummaries] = useState<PriceSummary[]>([]);
  const [vintage, setVintage] = useState<string | null>(null);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // The tasting form opens as a sheet that grows out of the button pressed.
  const [sheet, setSheet] = useState<{ kind: TastingKind; origin: Rect; closing: boolean } | null>(null);
  const cellarButton = useRef<View>(null);
  const logButton = useRef<View>(null);
  const { width: W, height: H } = useWindowDimensions();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [allVintages, setAllVintages] = useState(false);
  const [allShops, setAllShops] = useState(false);
  // Which vintage the prices on screen are for; until it matches, the price card shows placeholders.
  const [pricesFor, setPricesFor] = useState<string | null>(null);
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
        setPricesFor(vintage ?? '*');
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, wineId, vintage, reloadKey]);

  // Opened from My wines ("Log tasting", "Add bottles"): grow from where the toolbar sits.
  const openedFromParam = useRef(false);
  useEffect(() => {
    if (!wine || openedFromParam.current || (add !== 'cellar' && add !== 'tasted')) return;
    openedFromParam.current = true;
    setSheet({ kind: add, origin: { x: W / 2 - 80, y: H - insets.bottom - 56, width: 160, height: 46 }, closing: false });
  }, [wine, add, W, H, insets.bottom]);

  async function openSheet(kind: TastingKind) {
    const origin = (await measure(kind === 'cellar' ? cellarButton : logButton)) ?? { x: W / 2 - 80, y: H - insets.bottom - 56, width: 160, height: 46 };
    setSheet({ kind, origin, closing: false });
  }
  const closeSheet = () => setSheet((s) => (s ? { ...s, closing: true } : s));
  const sheetClosed = useCallback(() => setSheet(null), []);

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
  const style = wineStyleOf(wine?.colour, wine?.wine_type);
  const byVintage = summaries.filter((s) => s.vintage_key !== '*').sort((a, b) => b.vintage_key.localeCompare(a.vintage_key));
  const max = Math.max(1, ...byVintage.map((s) => s.median_cents));
  const summary = prices?.summary;
  const span = summary ? summary.p90_cents - summary.p10_cents : 0;
  const marker = summary && span > 0 ? Math.min(1, Math.max(0, (summary.median_cents - summary.p10_cents) / span)) : 0.5;
  const offers = prices?.offers ?? [];
  const solidTint = glass === 'solid' || glass === 'contrast';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" bottomOffset={24} contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        {/* The photo leads: full width, under the status bar; glass controls float over it. */}
        {!wine && !error ? (
          <View style={{ paddingTop: insets.top + 64, paddingHorizontal: space[4] }}>
            <WineSkeleton />
          </View>
        ) : wine ? (
          <WinePhoto uri={wine.image_url} wineStyle={style} padding={space[6]} emptyLabel="No photo yet" style={{ width: '100%', height: wine.image_url ? size.photoHero + insets.top : 220 + insets.top, paddingTop: wine.image_url ? insets.top : insets.top + 40 }}>
            {wine.image_url && wine.image_match === 'producer' ? (
              <View style={{ position: 'absolute', left: space[3], bottom: space[3] }}>
                <Glass style={{ borderRadius: radius.pill }}>
                  <Text style={[type.footnote, { color: c.ink, paddingVertical: 6, paddingHorizontal: space[3] }]}>Photo of another wine from this producer</Text>
                </Glass>
              </View>
            ) : null}
          </WinePhoto>
        ) : (
          <View style={{ height: insets.top + 64 }} />
        )}

        <View style={{ paddingHorizontal: space[4], paddingTop: space[4], gap: space[5] }}>
          {wine && (
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="header" style={[type.wineDisplay, { color: c.ink }]}>{title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
                <StyleDot wineStyle={style} />
                <Text style={[type.subhead, { color: c.ink2 }]}>
                  {[STYLE_LABEL[style], [wine.sub_region, wine.region, wine.country].filter(Boolean).slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {wine.grape || wine.lwin ? <Muted style={{ color: c.ink3 }}>{[wine.grape, wine.lwin && `LWIN ${wine.lwin}`].filter(Boolean).join(' · ')}</Muted> : null}
            </View>
          )}

          {wine ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Heading>Market price · {vintage ?? 'all vintages'}</Heading>
                <Button title="Check" variant="plain" size="sm" busy={busy} onPress={refresh} icon={(fg) => <RefreshIcon color={fg} />} accessibilityLabel="Check prices now" />
              </View>
              {pricesFor !== (vintage ?? '*') ? (
                <Skeleton label="Loading prices">
                  <View style={{ gap: 10 }}>
                    <PriceBones />
                  </View>
                </Skeleton>
              ) : summary ? (
                <View style={{ gap: space[2] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2], flexWrap: 'wrap' }}>
                    <Text style={[type.figureLg, { color: c.ink }]}>{dollars(summary.median_cents)}</Text>
                    <Muted>median · per 750 ml · {summary.n_observations} {summary.n_observations === 1 ? 'offer' : 'offers'}</Muted>
                  </View>
                  <View accessible accessibilityLabel={`Range ${dollars(summary.p10_cents)} to ${dollars(summary.p90_cents)}`} style={{ height: 8, borderRadius: 4, marginTop: space[2], backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent }}>
                    <View style={{ position: 'absolute', left: `${marker * 100}%`, top: -5, width: 3, height: 16, marginLeft: -1.5, borderRadius: 2, backgroundColor: c.accent }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Muted style={type.tabular}>{dollars(summary.p10_cents)} low</Muted>
                    <Muted style={type.tabular}>{dollars(summary.p90_cents)} high</Muted>
                  </View>
                  {summary.out_of_stock_only ? <Muted style={{ color: c.caution }}>Out of stock everywhere: this is what shops listed it at.</Muted> : null}
                  {summary.window_days > 30 ? <Muted style={{ color: c.caution }}>Based on the last year (nothing more recent).</Muted> : null}
                </View>
              ) : (
                <Muted>No current retail price.</Muted>
              )}
            </Card>
          ) : null}

          {byVintage.length > 0 && (
            <Card>
              <Heading>By vintage</Heading>
              {(allVintages ? byVintage : byVintage.slice(0, 8)).map((s) => {
                const on = s.vintage_key === vintage;
                return (
                  <Pressable
                    key={s.vintage_key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${s.vintage_key}, ${dollars(s.median_cents)}`}
                    onPress={() => setVintage(on ? null : s.vintage_key)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 32 }}
                  >
                    <Text style={[type.subhead, type.tabular, { width: 44, fontWeight: on ? '700' : '400', color: on ? c.accent : c.ink }]}>{s.vintage_key}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ height: 8, borderRadius: 4, width: `${(s.median_cents / max) * 100}%`, backgroundColor: on ? c.accent : c.accentSoft }} />
                    </View>
                    <Text style={[type.subhead, type.tabular, { width: 84, textAlign: 'right', fontWeight: '600', color: c.ink }]}>{dollars(s.median_cents)}</Text>
                  </Pressable>
                );
              })}
              {byVintage.length > 8 ? (
                <Button title={allVintages ? 'Show fewer' : `Show all ${byVintage.length} vintages`} variant="plain" size="sm" onPress={() => setAllVintages(!allVintages)} />
              ) : null}
            </Card>
          )}

          {offers.length > 0 && (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Heading>Where to buy</Heading>
                {offers.length > 3 ? <Button title={allShops ? 'Fewer' : `All ${Math.min(offers.length, 8)}`} variant="plain" size="sm" onPress={() => setAllShops(!allShops)} /> : null}
              </View>
              <View>
                {offers.slice(0, allShops ? 8 : 3).map((o, i) => (
                  <View key={o.url + o.observed_at}>
                    {i ? <Divider /> : null}
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => o.url.startsWith('http') && Linking.openURL(o.url)}
                      style={({ pressed }) => [{ minHeight: size.tapMin, paddingVertical: space[2], flexDirection: 'row', alignItems: 'center', gap: space[3] }, pressed && { opacity: 0.6 }]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.subhead, { color: c.ink }]} numberOfLines={1}>{o.merchant ?? 'Shop'}</Text>
                        <Muted style={o.in_stock === false ? { color: c.negative } : undefined}>
                          {[o.in_stock === false ? 'Out of stock' : null, o.vintage_key, o.bottle_ml !== 750 ? `${o.bottle_ml} ml` : null].filter(Boolean).join(' · ') || ' '}
                        </Muted>
                      </View>
                      <Text style={[type.figure, { color: c.ink }]}>{dollars(o.price_cents)}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Card>
          )}

          {wine ? <WineAbout res={about} /> : null}

          {message ? <Muted>{message}</Muted> : null}
          <ErrorText error={error} />

        </View>
      </KeyboardAwareScrollView>

      {/* Floating controls: glass over the photo and the content scrolling under it. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + space[2], left: space[4], right: space[4], flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton glass label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
        <IconButton glass label={saved ? 'Saved to watch list' : 'Save to watch list'} onPress={save}>
          <BookmarkIcon color={saved ? c.accent : c.ink} filled={saved} />
        </IconButton>
      </View>

      {wine ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: space[4], right: space[4], bottom: Math.max(insets.bottom - 6, space[3]), alignItems: 'center' }}>
          <Glass style={{ borderRadius: radius.pill }}>
            <View accessibilityRole="toolbar" style={{ flexDirection: 'row', padding: 4, gap: 2 }}>
              <Pressable
                ref={cellarButton}
                accessibilityRole="button"
                onPress={() => openSheet('cellar')}
                style={({ pressed }) => [{ height: size.controlLg - 4, paddingHorizontal: space[4], borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: space[2] }, pressed && { opacity: 0.7 }]}
              >
                <BottleIcon color={c.ink} size={20} />
                <Text style={[type.subhead, { fontWeight: '600', color: c.ink }]}>Add to cellar</Text>
              </Pressable>
              <Pressable
                ref={logButton}
                accessibilityRole="button"
                onPress={() => openSheet('tasted')}
                style={({ pressed }) => [
                  { height: size.controlLg - 4, paddingHorizontal: space[5], borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: solidTint ? c.accent : c.glassTint },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <PlusIcon color={c.onAccent} size={20} />
                <Text style={[type.subhead, { fontWeight: '600', color: c.onAccent }]}>Log tasting</Text>
              </Pressable>
            </View>
          </Glass>
        </View>
      ) : null}

      {wine && sheet ? (
        <ExpandingSheet
          origin={sheet.origin}
          label={sheet.kind === 'cellar' ? 'Add to cellar' : 'Log tasting'}
          tint={sheet.kind === 'tasted'}
          title={sheet.kind === 'cellar' ? 'Add to cellar' : 'Log tasting'}
          closing={sheet.closing}
          onRequestClose={closeSheet}
          onClosed={sheetClosed}
        >
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" bottomOffset={24} contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: insets.bottom + space[6] }}>
            <Muted style={{ marginBottom: space[3] }} numberOfLines={2}>{title}</Muted>
            <TastingForm
              wineId={wineId}
              vintage={vintage ?? (addVintage || null)}
              kind={sheet.kind}
              suggestedTags={about?.info?.descriptors}
              onSaved={(k) => { closeSheet(); setMessage(k === 'cellar' ? 'Added to your cellar' : 'Tasting saved'); }}
            />
          </KeyboardAwareScrollView>
        </ExpandingSheet>
      ) : null}
    </View>
  );
}

