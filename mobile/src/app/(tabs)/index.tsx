/**
 * Add Wine: photograph a label -> read on the phone (Apple Vision) and matched
 * by the API -> "Is this it?" with what you paid, a rating and notes -> logged.
 * Or search the catalog / add a wine by hand (components/AddSearch.tsx).
 * Lineup mode: one photo of several bottles -> every label read by the API ->
 * confirm them all at once (components/LineupReview.tsx).
 */
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Animated, Easing, Image, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SearchBar, SearchResults } from '../../components/AddSearch';
import { Glass } from '../../components/Glass';
import { BackIcon, CheckIcon, ChevronIcon, PhotosIcon } from '../../components/icons';
import { LineupReview } from '../../components/LineupReview';
import { TastingFields, useTastingDraft } from '../../components/TastingForm';
import { Button, Card, Chip, Divider, ErrorText, Field, Heading, IconButton, Label, Muted, Screen, Segmented, Title, radius, size, space, type, useStyles, useTheme } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { dollars, wineTitle } from '../../lib/format';
import { LINEUP_MAX_SIDE, prepareLabelPhoto, readLabelText } from '../../lib/photo';
import { forgetScan, newScanRef, pendingScan, rememberScan, scanAnswer, type ScanMode } from '../../lib/pendingScan';
import type { Candidate, PriceSummary, ScanResult, Wine } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Mode = ScanMode;
type Step =
  | { kind: 'idle' }
  | { kind: 'scanning'; uri: string; lines: string[] }
  | { kind: 'review'; uri: string; scan: ScanResult }
  | { kind: 'lineup'; uri: string; scans: ScanResult[] };

const RETICLE = { w: 236, h: 316 };

export default function ScanScreen() {
  const api = useApi();
  const { c } = useTheme();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [mode, setMode] = useState<Mode>('single');
  // Searching: the search bar moves to the top and the results replace the camera panel.
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The scan in progress (its ref), and whether its answer is already being collected from the server.
  const active = useRef<string | null>(null);
  const collecting = useRef<string | null>(null);

  const finish = useCallback((ref: string, mode: Mode, uri: string, result: unknown) => {
    if (active.current !== ref) return;
    active.current = null;
    void forgetScan();
    setStep(mode === 'lineup' ? { kind: 'lineup', uri, scans: (result as { scans: ScanResult[] }).scans } : { kind: 'review', uri, scan: result as ScanResult });
  }, []);
  const fail = useCallback((ref: string, e: unknown) => {
    if (active.current !== ref) return;
    active.current = null;
    void forgetScan();
    setError(e instanceof ApiError && e.status === 503 ? new Error('Label reading is not set up on the server yet.') : e);
    setStep({ kind: 'idle' });
  }, []);
  // Ask the server how the scan came out (the app was away when the answer came back).
  const collect = useCallback(async (ref: string, mode: Mode, uri: string) => {
    if (collecting.current === ref) return;
    collecting.current = ref;
    try {
      finish(ref, mode, uri, await scanAnswer(api, ref));
    } catch (e) {
      fail(ref, e);
    } finally {
      if (collecting.current === ref) collecting.current = null;
    }
  }, [api, finish, fail]);

  // A scan started before the app was switched away (or closed by iOS): pick it up again.
  useEffect(() => {
    let cancelled = false;
    const resume = async () => {
      const p = await pendingScan();
      if (cancelled || !p) return;
      if (active.current && active.current !== p.ref) return;
      if (!active.current) {
        active.current = p.ref;
        setMode(p.mode);
        setStep({ kind: 'scanning', uri: p.uri, lines: [] });
      }
      void collect(p.ref, p.mode, p.uri);
    };
    void resume();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void resume());
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [collect]);

  async function pick(fromCamera: boolean) {
    setError(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', fromCamera ? 'Allow camera access to scan labels.' : 'Allow photo access to choose a label photo.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const ref = newScanRef();
    const scanMode = mode;
    active.current = ref;
    setStep({ kind: 'scanning', uri: asset.uri, lines: [] });
    let sent = false;
    try {
      // Remembered until the answer is in, so it survives switching apps.
      const send = async <T,>(upload: () => Promise<T>) => {
        await rememberScan({ ref, uri: asset.uri, mode: scanMode, startedAt: Date.now() });
        sent = true;
        return upload();
      };
      if (scanMode === 'lineup') {
        // Several labels in one photo: the phone's text reader would run them together, so the API reads them.
        const photo = await prepareLabelPhoto(asset, LINEUP_MAX_SIDE);
        finish(ref, scanMode, asset.uri, await send(() => api.scanLineup(photo, ref)));
        return;
      }
      const photo = await prepareLabelPhoto(asset);
      const ocrText = await readLabelText(photo.uri);
      if (ocrText && active.current === ref) setStep({ kind: 'scanning', uri: asset.uri, lines: ocrText.split('\n') });
      finish(ref, scanMode, asset.uri, await send(() => api.scan({ ...photo, ocrText }, ref)));
    } catch (e) {
      // The connection dropped while the app was away, or the server is still reading it: collect the answer instead.
      if (sent && (!(e instanceof ApiError) || e.status === 409)) void collect(ref, scanMode, asset.uri);
      else fail(ref, e);
    }
  }

  if (step.kind === 'review') {
    return <Review uri={step.uri} scan={step.scan} onDone={() => setStep({ kind: 'idle' })} />;
  }
  if (step.kind === 'lineup') {
    return <LineupReview uri={step.uri} scans={step.scans} onDone={() => setStep({ kind: 'idle' })} />;
  }
  const lineup = mode === 'lineup';

  const scanning = step.kind === 'scanning';
  if (searching) {
    return (
      <Screen keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <SearchBar value={query} onChangeText={setQuery} autoFocus />
          <Button title="Cancel" variant="plain" size="md" onPress={() => { setQuery(''); setSearching(false); }} />
        </View>
        <SearchResults query={query} />
      </Screen>
    );
  }
  return (
    <Screen scrollEnabled={false}>
      <Title>Add wine</Title>

      <Viewfinder uri={scanning ? step.uri : null} lines={scanning ? step.lines : []} active={scanning} onPress={() => !scanning && pick(true)} />

      <Text style={[lineup ? type.headline : type.title2, { color: c.ink, textAlign: 'center' }]}>
        {scanning
          ? lineup ? 'Reading the labels…' : 'Reading the label…'
          : lineup ? 'Line up to 12 bottles side by side with all details visible' : 'Point at the front label'}
      </Text>
      {!scanning ? (
        <Segmented options={[{ key: 'single', label: 'One bottle' }, { key: 'lineup', label: 'Lineup' }]} value={mode} onChange={setMode} />
      ) : null}
      <ErrorText error={error} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <IconButton label="Choose from photos" size={size.controlLg} onPress={() => !scanning && pick(false)}>
          <PhotosIcon color={c.ink} />
        </IconButton>
        <SearchBar value={query} onChangeText={(q) => { setQuery(q); setSearching(true); }} onFocus={() => setSearching(true)} />
      </View>
    </Screen>
  );
}

function StatusPill({ children, check }: { children: string; check?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
      {check ? <CheckIcon color={c.positive} /> : null}
      <Text style={[type.footnote, { color: c.ink2 }]}>{children}</Text>
    </View>
  );
}

/** The camera panel: label frame, a sweeping scan line while reading, and the words read so far. */
function Viewfinder({ uri, lines, active, onPress }: { uri: string | null; lines: string[]; active: boolean; onPress: () => void }) {
  const { height } = useWindowDimensions();
  const { c, reduceMotion } = useTheme();
  const [sweep] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active || reduceMotion) {
      sweep.setValue(0.46);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, sweep]);

  // Short phones (iPhone SE) also need room for the mode switch and the shutter below.
  const panel = Math.min(430, height * 0.5, height - 400);
  const corner = { position: 'absolute' as const, width: 34, height: 34, borderColor: c.accent };
  const chips = lines.map((l) => l.trim()).filter((l) => l && l.length <= 28).slice(0, 6);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={uri ? 'Label photo' : 'Take a photo of a label'}
      onPress={onPress}
      style={{ height: panel, borderRadius: radius.lg, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} resizeMode="cover" />
      ) : null}
      <View style={{ width: RETICLE.w, height: Math.min(RETICLE.h, panel - 90) }}>
        <View style={[corner, { left: 0, top: 0, borderLeftWidth: 2, borderTopWidth: 2, borderTopLeftRadius: 14 }]} />
        <View style={[corner, { right: 0, top: 0, borderRightWidth: 2, borderTopWidth: 2, borderTopRightRadius: 14 }]} />
        <View style={[corner, { left: 0, bottom: 0, borderLeftWidth: 2, borderBottomWidth: 2, borderBottomLeftRadius: 14 }]} />
        <View style={[corner, { right: 0, bottom: 0, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 14 }]} />
        <Animated.View
          style={{
            position: 'absolute', left: 16, right: 16, top: 0, height: 2, borderRadius: 1, backgroundColor: c.accent,
            transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [12, Math.min(RETICLE.h, panel - 90) - 12] }) }],
          }}
        />
      </View>
      {!uri ? (
        <Text style={[type.subhead, { position: 'absolute', bottom: space[5], color: c.ink2 }]}>Tap to photograph a label</Text>
      ) : null}
      {chips.length ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((chip, i) => (
            <Glass key={`${chip}-${i}`} style={{ borderRadius: radius.pill }}>
              <Text style={[type.footnote, { paddingVertical: 4, paddingHorizontal: 10, fontWeight: /^(19|20)\d\d$/.test(chip) ? '700' : '500', color: c.ink }]}>{chip}</Text>
            </Glass>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** "Is this it?": the matched wine, today's price, and the tasting - or a choice of wines when unsure. */
function Review({ uri, scan, onDone }: { uri: string; scan: ScanResult; onDone: () => void }) {
  const api = useApi();
  const { c, scheme } = useTheme();
  const s = useStyles();
  const [selected, setSelected] = useState<Candidate | null>(scan.outcome === 'auto' ? scan.candidates[0] ?? null : null);
  const [confirmedId, setConfirmedId] = useState<number | null>(null);
  const [fetched, setFetched] = useState<{ wine: Wine; prices: PriceSummary[] } | null>(null);
  const details = fetched && selected && fetched.wine.wine_id === selected.wineId ? fetched : null;
  const [newWine, setNewWine] = useState({ producer: scan.read.producer, name: scan.read.name, region: scan.read.region });
  const draft = useTastingDraft(scan.vintage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api.wine(selected.wineId).then((d) => !cancelled && setFetched(d), () => {});
    return () => {
      cancelled = true;
    };
  }, [api, selected]);

  const vintage = draft.vintage.trim().toUpperCase();
  const market = details?.prices.find((p) => p.vintage_key === vintage) ?? details?.prices.find((p) => p.vintage_key === '*');
  const onDevice = scan.source?.startsWith('ocr');

  async function log() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const tasting = draft.toTasting();
      if (confirmedId !== selected.wineId) await api.confirmScan(scan.scanId, { wineId: selected.wineId });
      await api.addTasting({ wineId: selected.wineId, scanId: scan.scanId, ...tasting });
      onDone();
      router.push(tasting.kind === 'cellar' ? '/wines?mode=cellar' : '/wines?mode=tastings');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function addWine() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.confirmScan(scan.scanId, { newWine });
      setConfirmedId(r.wineId);
      setSelected({ wineId: r.wineId, displayName: r.wine.display_name, region: r.wine.region, country: r.wine.country, score: 1 });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <IconButton label="Back to scan" onPress={onDone}>
        <BackIcon color={c.ink} size={20} />
      </IconButton>
      <StatusPill check={Boolean(selected)}>{onDevice ? 'Identified on device' : 'Read in the cloud'}</StatusPill>
      <View style={{ width: size.tapMin }} />
    </View>
  );

  if (!selected) {
    return (
      <Screen>
        {header}
        <Image source={{ uri }} accessibilityLabel="Your label photo" style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: c.surfaceSunken }} resizeMode="cover" />
        {scan.candidates.length > 0 ? (
          <View style={{ gap: space[2] }}>
            <Heading>Which wine is it?</Heading>
            <Card flush>
              {scan.candidates.map((cand, i) => (
                <View key={cand.wineId}>
                  {i ? <Divider style={{ marginLeft: space[4] }} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelected(cand)}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.row, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[type.wineTitle, { color: c.ink }]}>{cand.displayName}</Text>
                      <Muted style={type.subhead}>{[cand.region, cand.country].filter(Boolean).join(' · ')}</Muted>
                    </View>
                    <ChevronIcon color={c.ink3} />
                  </Pressable>
                </View>
              ))}
            </Card>
          </View>
        ) : (
          <Card>
            <Label>We read</Label>
            <Text style={[type.wineTitle, { color: c.ink }]}>{[scan.read.producer, scan.read.name].filter(Boolean).join(' ') || 'Nothing legible'}</Text>
            <Muted>Not in the catalog yet. Add it below.</Muted>
          </Card>
        )}
        <Card>
          <Heading>{scan.candidates.length ? 'None of these? Add it' : 'Add this wine'}</Heading>
          <Field label="Producer" value={newWine.producer} onChangeText={(producer) => setNewWine({ ...newWine, producer })} />
          <Field label="Wine" value={newWine.name} onChangeText={(name) => setNewWine({ ...newWine, name })} />
          <Field label="Region" value={newWine.region} onChangeText={(region) => setNewWine({ ...newWine, region })} />
          <Button title="Add wine" variant="tinted" busy={busy} onPress={addWine} />
        </Card>
        <ErrorText error={error} />
      </Screen>
    );
  }

  const w = details?.wine;
  return (
    <Screen>
      {header}
      {/* The person's own label photo leads. */}
      <Image source={{ uri }} accessibilityLabel="Your label photo" style={{ width: '100%', height: 300, borderRadius: radius.lg, backgroundColor: c.surfaceSunken }} resizeMode="cover" />
      <View style={{ gap: 6 }}>
        <Muted>Is this it?</Muted>
        <Text accessibilityRole="header" style={[type.wineDisplay, { color: c.ink }]}>{wineTitle(selected.displayName, w?.sub_region)}</Text>
        <Text style={[type.subhead, { color: c.ink2 }]}>
          {[w?.sub_region || selected.region, w?.sub_region ? w.region : selected.country, w?.colour ? w.colour[0]!.toUpperCase() + w.colour.slice(1) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
          <TextInput
            accessibilityLabel="Vintage"
            value={draft.vintage}
            onChangeText={draft.setVintage}
            placeholder="Vintage"
            placeholderTextColor={c.ink3}
            autoCapitalize="characters"
            keyboardAppearance={scheme}
            maxLength={4}
            style={[s.input, type.tabular, { width: 96, textAlign: 'center', fontWeight: '600' }]}
          />
          {scan.bottleMl ? <Chip small>{`${scan.bottleMl} ml`}</Chip> : null}
          {w?.lwin ? <Chip small>{`LWIN ${w.lwin}`}</Chip> : null}
        </View>
        <Divider />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space[3] }}>
          <View>
            <Muted>{market ? `Market now · ${market.vintage_key === '*' ? 'all vintages' : market.vintage_key}` : 'Market now'}</Muted>
            <Text style={[type.figureLg, { marginTop: 2, color: market ? c.ink : c.ink3 }]}>{market ? dollars(market.median_cents) : '—'}</Text>
          </View>
          <Muted style={{ textAlign: 'right', maxWidth: 150 }}>{market ? 'Median of recent US retail offers, per 750 ml' : details ? 'No market price yet' : ''}</Muted>
        </View>
      </Card>

      <TastingFields draft={draft} />
      <ErrorText error={error} />
      <View style={{ gap: 10 }}>
        <Button title={draft.kind === 'cellar' ? 'Add to cellar' : 'Log tasting'} busy={busy} onPress={log} />
        {confirmedId !== selected.wineId ? <Button title="Not this wine" variant="secondary" size="md" style={{ alignSelf: 'stretch' }} onPress={() => setSelected(null)} /> : null}
      </View>
    </Screen>
  );
}
