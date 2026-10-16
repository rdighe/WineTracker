/**
 * Scan: photo of a label -> read on the phone (Apple Vision) and matched by the
 * API -> "Is this it?" with what you paid, a rating and notes -> logged.
 */
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Animated, Easing, Image, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import LabelText from '../../../modules/label-text';
import { BackIcon, CheckIcon, PhotosIcon, SearchIcon } from '../../components/icons';
import { TastingFields, useTastingDraft } from '../../components/TastingForm';
import { Button, Card, Chip, ErrorText, Eyebrow, Field, IconButton, Mono, Muted, Screen, colors, fonts, glow, styles } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { dollarsExact, wineTitle } from '../../lib/format';
import { prepareLabelPhoto, readLabelText } from '../../lib/photo';
import type { Candidate, PriceSummary, ScanResult, Wine } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Step =
  | { kind: 'idle' }
  | { kind: 'scanning'; uri: string; lines: string[] }
  | { kind: 'review'; uri: string; scan: ScanResult };

const RETICLE = { w: 236, h: 316 };

export default function ScanScreen() {
  const api = useApi();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);

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
    setStep({ kind: 'scanning', uri: asset.uri, lines: [] });
    try {
      const photo = await prepareLabelPhoto(asset);
      const ocrText = await readLabelText(photo.uri);
      if (ocrText) setStep({ kind: 'scanning', uri: asset.uri, lines: ocrText.split('\n') });
      const scan = await api.scan({ ...photo, ocrText });
      setStep({ kind: 'review', uri: asset.uri, scan });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? new Error('Label reading is not set up on the server yet.') : e);
      setStep({ kind: 'idle' });
    }
  }

  if (step.kind === 'review') {
    return <Review uri={step.uri} scan={step.scan} onDone={() => setStep({ kind: 'idle' })} />;
  }

  const scanning = step.kind === 'scanning';
  return (
    <Screen scrollEnabled={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 3.6, textTransform: 'uppercase', color: colors.text }}>WineTracker</Text>
        <StatusPill dot>{LabelText ? 'Reading on device' : 'Reading in the cloud'}</StatusPill>
      </View>

      <Viewfinder uri={scanning ? step.uri : null} lines={scanning ? step.lines : []} active={scanning} onPress={() => !scanning && pick(true)} />

      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 20, letterSpacing: -0.2, color: colors.text }}>
          {scanning ? 'Reading the label…' : 'Point at the front label'}
        </Text>
        <Muted>{scanning ? 'One moment.' : LabelText ? 'Hold steady. We read it on your iPhone first.' : 'A clear, straight-on photo works best.'}</Muted>
      </View>
      <ErrorText error={error} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 }}>
        <IconButton label="Choose from photos" size={52} onPress={() => !scanning && pick(false)}>
          <PhotosIcon color={colors.text} />
        </IconButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan label"
          disabled={scanning}
          onPress={() => pick(true)}
          style={({ pressed }) => [{ width: 78, height: 78, borderRadius: 39, borderWidth: 2, borderColor: colors.accent, padding: 5, ...glow }, (pressed || scanning) && { opacity: 0.6 }]}
        >
          <View style={{ flex: 1, borderRadius: 39, backgroundColor: colors.accent }} />
        </Pressable>
        <IconButton label="Search instead" size={52} onPress={() => router.push('/search')}>
          <SearchIcon color={colors.text} />
        </IconButton>
      </View>
    </Screen>
  );
}

function StatusPill({ children, dot, check }: { children: string; dot?: boolean; check?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, ...glow }} /> : null}
      {check ? <CheckIcon color={colors.accent} /> : null}
      <Text style={{ fontFamily: fonts.regular, fontSize: 11, color: colors.muted }}>{children}</Text>
    </View>
  );
}

/** The camera panel: label frame, a sweeping scan line while reading, and the words read so far. */
function Viewfinder({ uri, lines, active, onPress }: { uri: string | null; lines: string[]; active: boolean; onPress: () => void }) {
  const { height } = useWindowDimensions();
  const [sweep] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active) {
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
  }, [active, sweep]);

  const corner = { position: 'absolute' as const, width: 34, height: 34, borderColor: colors.accent };
  const chips = lines.map((l) => l.trim()).filter((l) => l && l.length <= 28).slice(0, 6);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={uri ? 'Label photo' : 'Take a photo of a label'}
      onPress={onPress}
      style={{ height: Math.min(430, height * 0.5), borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.85 }} resizeMode="cover" />
      ) : null}
      <View style={{ width: RETICLE.w, height: Math.min(RETICLE.h, height * 0.5 - 90) }}>
        <View style={[corner, { left: 0, top: 0, borderLeftWidth: 2, borderTopWidth: 2, borderTopLeftRadius: 14 }]} />
        <View style={[corner, { right: 0, top: 0, borderRightWidth: 2, borderTopWidth: 2, borderTopRightRadius: 14 }]} />
        <View style={[corner, { left: 0, bottom: 0, borderLeftWidth: 2, borderBottomWidth: 2, borderBottomLeftRadius: 14 }]} />
        <View style={[corner, { right: 0, bottom: 0, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 14 }]} />
        <Animated.View
          style={{
            position: 'absolute', left: 16, right: 16, top: 0, height: 1, backgroundColor: colors.accent, opacity: 0.85, ...glow, shadowOpacity: 0.9, shadowRadius: 8,
            transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [12, Math.min(RETICLE.h, height * 0.5 - 90) - 12] }) }],
          }}
        />
      </View>
      {!uri ? (
        <Text style={{ position: 'absolute', bottom: 20, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: colors.faint }}>Tap to photograph a label</Text>
      ) : null}
      {chips.length ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((c, i) => (
            <View key={`${c}-${i}`} style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, backgroundColor: 'rgba(13,10,14,0.72)', borderWidth: 1, borderColor: colors.line2 }}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: /^(19|20)\d\d$/.test(c) ? colors.gold : colors.text }}>{c.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** "Is this it?": the matched wine, today's price, and the tasting - or a choice of wines when unsure. */
function Review({ uri, scan, onDone }: { uri: string; scan: ScanResult; onDone: () => void }) {
  const api = useApi();
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
      router.push(tasting.kind === 'cellar' ? '/tastings?show=cellar' : '/tastings');
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
        <BackIcon color={colors.text} />
      </IconButton>
      <StatusPill check={Boolean(selected)}>{onDevice ? 'Identified on device' : 'Read in the cloud'}</StatusPill>
      <View style={{ width: 40 }} />
    </View>
  );

  if (!selected) {
    return (
      <Screen>
        {header}
        {scan.candidates.length > 0 ? (
          <Card style={{ gap: 4 }}>
            <Eyebrow>Which wine is it?</Eyebrow>
            {scan.candidates.map((c, i) => (
              <Pressable
                key={c.wineId}
                accessibilityRole="button"
                onPress={() => setSelected(c)}
                style={({ pressed }) => [{ paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: colors.line }, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.h2}>{c.displayName}</Text>
                <Muted>{[c.region, c.country].filter(Boolean).join(' · ')}</Muted>
              </Pressable>
            ))}
          </Card>
        ) : (
          <Card>
            <Eyebrow>We read</Eyebrow>
            <Text style={styles.h2}>{[scan.read.producer, scan.read.name].filter(Boolean).join(' ') || 'Nothing legible'}</Text>
            <Muted>Not in the catalog yet. Add it below.</Muted>
          </Card>
        )}
        <Card>
          <Eyebrow>{scan.candidates.length ? 'None of these? Add it' : 'Add this wine'}</Eyebrow>
          <Field label="Producer" value={newWine.producer} onChangeText={(producer) => setNewWine({ ...newWine, producer })} />
          <Field label="Wine" value={newWine.name} onChangeText={(name) => setNewWine({ ...newWine, name })} />
          <Field label="Region" value={newWine.region} onChangeText={(region) => setNewWine({ ...newWine, region })} />
          <Button title="Add wine" variant="secondary" busy={busy} onPress={addWine} />
        </Card>
        <ErrorText error={error} />
      </Screen>
    );
  }

  const w = details?.wine;
  return (
    <Screen>
      {header}
      <Card style={{ padding: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
          <Image source={{ uri }} style={{ width: 64, height: 88, borderRadius: 14, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.surface2 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <Eyebrow>Is this it?</Eyebrow>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, color: colors.text }}>{wineTitle(selected.displayName, w?.sub_region)}</Text>
            <Muted>{[w?.sub_region || selected.region, w?.sub_region ? w.region : selected.country, w?.colour ? w.colour[0]!.toUpperCase() + w.colour.slice(1) : null].filter(Boolean).join(' · ')}</Muted>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <TextInput
            accessibilityLabel="Vintage"
            value={draft.vintage}
            onChangeText={draft.setVintage}
            placeholder="Vintage"
            placeholderTextColor={colors.faint}
            autoCapitalize="characters"
            maxLength={4}
            style={{ width: 76, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.gold, color: colors.gold, fontFamily: fonts.mono, fontSize: 12 }}
          />
          {scan.bottleMl ? <Chip>{`${scan.bottleMl} ml`}</Chip> : null}
          {w?.lwin ? <Chip>{`LWIN ${w.lwin}`}</Chip> : null}
        </View>
        <View style={styles.divider} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Eyebrow>{market ? `Market now · ${market.vintage_key === '*' ? 'all vintages' : market.vintage_key}` : 'Market now'}</Eyebrow>
            <Mono style={{ marginTop: 4, fontFamily: fonts.monoMedium, fontSize: 30, color: market ? colors.gold : colors.faint }}>{market ? dollarsExact(market.median_cents) : '—'}</Mono>
          </View>
          <Muted style={{ fontSize: 12, textAlign: 'right', maxWidth: 140 }}>{market ? 'Median of recent US retail offers' : details ? 'No market price yet' : ''}</Muted>
        </View>
      </Card>

      <TastingFields draft={draft} />
      <ErrorText error={error} />
      <View style={{ gap: 10 }}>
        <Button title={draft.kind === 'cellar' ? 'Add to cellar' : 'Log tasting'} busy={busy} onPress={log} />
        {confirmedId !== selected.wineId ? <Button title="Not this wine" variant="secondary" onPress={() => setSelected(null)} /> : null}
      </View>
    </Screen>
  );
}
