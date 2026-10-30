/** Wine: the photo first, then market price (all vintages or one), price by vintage, where to buy, save, log a tasting. */
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExpandingSheet, measure, type Rect } from '../../components/ExpandingSheet';
import { Glass } from '../../components/Glass';
import { BackIcon, BookmarkIcon, BottleIcon, PlusIcon, RefreshIcon } from '../../components/icons';
import { CellarRow, TastingRow } from '../../components/EntryRows';
import { TastingForm, type TastingKind } from '../../components/TastingForm';
import { WineNotes } from '../../components/WineNotes';
import { WineAbout, useWineInfo } from '../../components/WineAbout';
import { PriceBones, Skeleton, WineSkeleton } from '../../components/Skeleton';
import { WinePhoto } from '../../components/WineThumb';
import { Button, Card, Divider, ErrorText, Heading, IconButton, Muted, StyleDot, radius, size, space, type, useTheme, wineStyleOf } from '../../components/ui';
import { dollars, wineTitle } from '../../lib/format';
import type { PriceSummary, PricesResponse, Tasting, Wine } from '../../lib/types';
import { useApi } from '../../lib/useApi';
import { useLocation } from '../../lib/location';
import { NearBar, nearNote, nearbyLabel } from '../../components/NearBar';

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
  // Where to buy near you: on whenever a location is known, unless switched to Anywhere.
  const loc = useLocation();
  const [anywhere, setAnywhere] = useState(false);
  const near = anywhere ? undefined : loc.near;
  // Which vintage the prices on screen are for; until it matches, the price card shows placeholders.
  const [pricesFor, setPricesFor] = useState<string | null>(null);
  const about = useWineInfo(wineId);
  // The user's own bottles and tastings of this wine.
  const [mine, setMine] = useState<Tasting[]>([]);
  const loadMine = useCallback(async () => {
    try {
      setMine((await api.tastings()).tastings.filter((t) => t.wine_id === wineId));
    } catch {
      // The page still works without them.
    }
  }, [api, wineId]);
  useFocusEffect(useCallback(() => void loadMine(), [loadMine]));
  const cellar = mine.filter((t) => t.kind === 'cellar');
  const tasted = mine.filter((t) => t.kind !== 'cellar');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await api.wine(wineId);
        const p = await api.prices(wineId, vintage, near);
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
  }, [api, wineId, vintage, reloadKey, near]);

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

  // Bookmarked? (My wines › Saved.)
  useEffect(() => {
    let cancelled = false;
    api.saved().then((r) => !cancelled && setSaved(r.saved.some((s) => Number(s.wine_id) === wineId)), () => {});
    return () => {
      cancelled = true;
    };
  }, [api, wineId]);

  async function save() {
    const next = !saved;
    // Answer the tap at once; put it back if the server says no.
    setSaved(next);
    try {
      if (next) await api.saveWine(wineId);
      else await api.unsaveWine(wineId);
      setMessage(next ? 'Saved. Find it in My wines › Saved.' : 'Removed from Saved');
    } catch (e) {
      setSaved(!next);
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
  const allOffers = prices?.offers ?? [];
  // Near you: only the shops close by or shipping there (closest first), unless none are.
  const offers = prices?.near?.applied ? allOffers.filter((o) => o.nearby) : allOffers;
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

          {cellar.length > 0 && (
            <Card style={{ gap: space[2] }}>
              <Heading>In your cellar · {cellar.reduce((n, t) => n + (t.bottles ?? 1), 0)} {cellar.reduce((n, t) => n + (t.bottles ?? 1), 0) === 1 ? 'bottle' : 'bottles'}</Heading>
              {cellar.map((t) => <CellarRow key={t.tasting_id} t={t} onChanged={loadMine} />)}
            </Card>
          )}
          {tasted.length > 0 && (
            <Card style={{ gap: space[2] }}>
              <Heading>Your tastings · {tasted.length}</Heading>
              {tasted.map((t) => <TastingRow key={t.tasting_id} t={t} onChanged={loadMine} />)}
            </Card>
          )}

          <WineNotes wineId={wineId} vintage={vintage} />

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
              <View style={{ gap: space[2], marginTop: space[2], marginBottom: space[1] }}>
                <NearBar on={!anywhere} onChange={(on) => setAnywhere(!on)} />
                {nearNote(prices?.near, 'shops') ? <Muted>{nearNote(prices?.near, 'shops')}</Muted> : null}
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
                        {o.nearby ? (
                          <Text style={[type.footnote, { color: c.positive }]} numberOfLines={1}>
                            {nearbyLabel(o.nearby)}{o.nearby.local && o.nearby.ships ? ' · also ships' : ''}
                          </Text>
                        ) : null}
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
        <IconButton glass label={saved ? 'Saved. Remove from Saved' : 'Save'} onPress={save}>
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
              onSaved={(k) => { closeSheet(); void loadMine(); setMessage(k === 'cellar' ? 'Added to your cellar' : 'Tasting saved'); }}
            />
          </KeyboardAwareScrollView>
        </ExpandingSheet>
      ) : null}
    </View>
  );
}

