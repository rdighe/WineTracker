/**
 * Picks: photograph a restaurant wine list (or a store shelf, ?kind=shelf)
 * and see its wines ranked for your palate, filtered to a price range.
 *
 * A wine list is read on the phone: Apple Vision reads the text, Apple
 * Intelligence turns it into wines (lib/wineList.ts); only what it can't
 * read goes to the server as text. The server matches each wine, scores it
 * with your taste profile, and flags the markup over typical retail. The
 * price range and glass/bottle switch filter on the phone, so changing them
 * is instant and free.
 */
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { BackIcon, CheckIcon, PhotosIcon, ScanIcon } from '../components/icons';
import { Button, Card, Chip, Divider, ErrorText, Field, Heading, IconButton, Muted, Screen, Segmented, Title, size, space, type, useTheme } from '../components/ui';
import { WineThumb } from '../components/WineThumb';
import { wineStyleOf } from '../components/theme';
import { dollars, wineTitle } from '../lib/format';
import { readListOnDevice, readListPhoto } from '../lib/wineList';
import type { ListEntry, PickItem, PickResult } from '../lib/types';
import { useApi } from '../lib/useApi';

type Serving = 'glass' | 'bottle';
type Range = { key: string; label: string; min: number | null; max: number | null };

/** Price ranges by serving, in dollars. */
const RANGES: Record<Serving, Range[]> = {
  glass: [
    { key: 'any', label: 'Any', min: null, max: null },
    { key: 'lo', label: 'Under $15', min: null, max: 15 },
    { key: 'mid', label: '$15–25', min: 15, max: 25 },
    { key: 'hi', label: '$25+', min: 25, max: null },
  ],
  bottle: [
    { key: 'any', label: 'Any', min: null, max: null },
    { key: 'lo', label: 'Under $60', min: null, max: 60 },
    { key: 'mid', label: '$60–120', min: 60, max: 120 },
    { key: 'hi', label: '$120+', min: 120, max: null },
  ],
};
const TOP = 3;

/** A page read so far: what the phone read, and text it left to the server. */
interface Page { entries: ListEntry[]; rest: string }

export default function PicksScreen() {
  const api = useApi();
  const { kind: kindParam } = useLocalSearchParams<{ kind?: string }>();
  const kind = kindParam === 'shelf' ? 'shelf' : 'list';
  const [pages, setPages] = useState<Page[]>([]);
  const [result, setResult] = useState<PickResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function addPhoto(fromCamera: boolean) {
    setError(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', fromCamera ? 'Allow camera access to photograph the list.' : 'Allow photo access to choose a photo of the list.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, allowsMultipleSelection: !fromCamera, selectionLimit: 6 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets.length) return;
    try {
      const added: Page[] = [];
      for (const [i, asset] of res.assets.entries()) {
        const n = pages.length + i + 1;
        setStatus(`Reading page ${n}…`);
        const rows = await readListPhoto(asset.uri);
        if (!rows) throw new Error('Reading wine lists needs the WineTracker iPhone app.');
        if (!rows.length) throw new Error('No text found in that photo. Try again closer, with the page flat and well lit.');
        added.push(await readListOnDevice(rows, (done, total) => setStatus(total > 1 ? `Reading page ${n} on your iPhone… ${done} of ${total}` : `Reading page ${n} on your iPhone…`)));
      }
      const all = [...pages, ...added];
      setPages(all);
      setStatus('Finding the best wines for you…');
      setResult(await api.pickFromList(all.flatMap((p) => p.entries), all.map((p) => p.rest).filter(Boolean).join('\n')));
    } catch (e) {
      setError(e);
    } finally {
      setStatus(null);
    }
  }

  // Opened from the + menu: straight to the camera, once the screen has slid in.
  const started = useRef(false);
  const addRef = useRef(addPhoto);
  useEffect(() => {
    addRef.current = addPhoto;
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = setTimeout(() => void addRef.current(true), 350);
    return () => clearTimeout(t);
  }, []);

  if (result && !status) return <Results result={result} pages={pages.length} onAddPage={() => addPhoto(true)} error={error} />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title>{kind === 'shelf' ? 'Store shelf' : 'Wine list'}</Title>
        <CloseButton />
      </View>
      <Card>
        <Heading>{status ?? 'Photograph the wine list'}</Heading>
        <Muted>
          {status
            ? 'Your iPhone reads the list itself when it has Apple Intelligence; the rest is read on the server.'
            : 'One page per photo, flat and well lit, prices included. You can add more pages after.'}
        </Muted>
        {!status ? (
          <View style={{ gap: space[2] }}>
            <Button title="Take a photo" icon={(color) => <ScanIcon color={color} size={20} />} onPress={() => addPhoto(true)} />
            <Button title="Choose photos" variant="secondary" icon={(color) => <PhotosIcon color={color} size={20} />} onPress={() => addPhoto(false)} />
          </View>
        ) : null}
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function CloseButton() {
  const { c } = useTheme();
  return (
    <IconButton label="Close" onPress={close} size={36}>
      <Text style={[type.headline, { color: c.ink2, lineHeight: 20 }]}>×</Text>
    </IconButton>
  );
}

const priceFor = (i: PickItem, s: Serving) => (s === 'glass' ? i.entry.glassCents : i.entry.bottleCents);

function Results({ result, pages, onAddPage, error }: { result: PickResult; pages: number; onAddPage: () => void; error: unknown }) {
  const api = useApi();
  const { c } = useTheme();
  /** Tapping a wine: have it, or open it. */
  const choose = (item: PickItem) => {
    const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: "I'm having this", onPress: () => void haveIt(api, item, serving) }];
    if (item.wineId) buttons.push({ text: 'See the wine', onPress: () => router.push(`/wine/${item.wineId}`) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title(item), undefined, buttons);
  };
  const glasses = result.items.filter((i) => i.entry.glassCents).length;
  const bottles = result.items.filter((i) => i.entry.bottleCents).length;
  const [serving, setServing] = useState<Serving>(glasses > bottles ? 'glass' : 'bottle');
  const [rangeKey, setRangeKey] = useState('any');
  const [custom, setCustom] = useState({ min: '', max: '' });
  const range = rangeKey === 'custom'
    ? { min: Number(custom.min) || null, max: Number(custom.max) || null }
    : RANGES[serving].find((r) => r.key === rangeKey) ?? RANGES[serving][0]!;

  const shown = result.items.filter((i) => {
    const p = priceFor(i, serving);
    if (p === null) return false;
    return (range.min === null || p >= range.min * 100) && (range.max === null || p <= range.max * 100);
  });
  const top = shown.slice(0, TOP);
  const rest = shown.slice(TOP);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton label="Back" onPress={close}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
        <Text style={[type.footnote, { color: c.ink2 }]}>
          {`${result.items.length} wines${pages > 1 ? ` · ${pages} pages` : ''}${result.source.startsWith('apple') ? ' · read on your iPhone' : ''}`}
        </Text>
        <View style={{ width: size.tapMin }} />
      </View>
      <Title>{result.mode === 'profile' ? 'Best for you' : 'Best value'}</Title>
      {result.mode === 'locked' ? (
        <Muted>{`Rate ${Math.max(1, 3 - result.rated)} more wine${3 - result.rated === 1 ? '' : 's'} to rank this list for your palate. Until then, the lowest markups come first.`}</Muted>
      ) : null}

      {glasses && bottles ? (
        <Segmented<Serving>
          options={[{ key: 'glass', label: `By the glass (${glasses})` }, { key: 'bottle', label: `Bottles (${bottles})` }]}
          value={serving}
          onChange={(s) => { setServing(s); if (rangeKey !== 'custom') setRangeKey('any'); }}
        />
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {RANGES[serving].map((r) => (
          <Chip key={r.key} small selected={rangeKey === r.key} onPress={() => setRangeKey(r.key)}>{r.label}</Chip>
        ))}
        <Chip small selected={rangeKey === 'custom'} onPress={() => setRangeKey('custom')}>Custom</Chip>
      </View>
      {rangeKey === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Field label="Min $" numeric value={custom.min} onChangeText={(min) => setCustom({ ...custom, min })} style={{ flex: 1 }} />
          <Field label="Max $" numeric value={custom.max} onChangeText={(max) => setCustom({ ...custom, max })} style={{ flex: 1 }} />
        </View>
      ) : null}

      {!shown.length ? <Muted>Nothing on the list in that range.</Muted> : null}
      {top.map((i, n) => <TopCard key={i.index} item={i} rank={n + 1} serving={serving} onPress={() => choose(i)} />)}
      {rest.length ? (
        <View style={{ gap: space[2] }}>
          <Heading>The rest of the list</Heading>
          <Card flush>
            {rest.map((i, n) => (
              <View key={i.index}>
                {n ? <Divider style={{ marginLeft: space[4] }} /> : null}
                <Row item={i} serving={serving} onPress={() => choose(i)} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      <ErrorText error={error} />
      <Button title="Add another page" variant="secondary" onPress={onAddPage} />
    </Screen>
  );
}

/** List price over typical retail: low is good value, 2-3x is usual for restaurants. */
function MarkupBadge({ item, serving }: { item: PickItem; serving: Serving }) {
  const { c } = useTheme();
  const m = serving === 'glass' ? item.glassMarkup : item.markup;
  if (m === null || !item.retailCents) return null;
  const [label, color] = m <= 2 ? ['Good value', c.positive] : m <= 3 ? ['Usual markup', c.ink2] : ['High markup', c.caution];
  return (
    <Text style={[type.footnote, { color }]}>
      {`${label} · ${m.toFixed(1)}× retail (${dollars(item.retailCents)}${serving === 'glass' ? ' a bottle' : ''})`}
    </Text>
  );
}

function MatchNote({ item }: { item: PickItem }) {
  const { c } = useTheme();
  if (item.match === 'matched') return null;
  return <Text style={[type.caption, { color: c.ink3 }]}>{item.match === 'likely' ? 'PROBABLY THIS WINE' : 'BEST GUESS FROM THE LIST'}</Text>;
}

const title = (i: PickItem) => [wineTitle(i.displayName, i.match === 'guess' ? null : i.region), i.entry.vintage].filter(Boolean).join(' ');

function TopCard({ item, rank, serving, onPress }: { item: PickItem; rank: number; serving: Serving; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <WineThumb uri={item.imageUrl} wineStyle={wineStyleOf(item.style || item.entry.colour, item.entry.style)} width={56} height={72} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.caption, { color: c.onAccent }]}>{rank}</Text>
              </View>
              <MatchNote item={item} />
            </View>
            <Text style={[type.wineTitle, { color: c.ink }]}>{title(item)}</Text>
            {item.region ? <Muted style={type.subhead}>{item.region}</Muted> : null}
          </View>
          <Text style={[type.figure, { color: c.ink }]}>{dollars(priceFor(item, serving))}</Text>
        </View>
        {item.reasons.length ? (
          <View style={{ gap: 2 }}>
            {item.reasons.map((r) => (
              <View key={r} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <CheckIcon color={c.positive} />
                <Text style={[type.subhead, { color: c.ink2, flex: 1 }]}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <MarkupBadge item={item} serving={serving} />
      </Card>
    </Pressable>
  );
}

function Row({ item, serving, onPress }: { item: PickItem; serving: Serving; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.row, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <MatchNote item={item} />
        <Text style={[type.body, { color: c.ink }]} numberOfLines={2}>{title(item)}</Text>
        {item.myRating !== null ? <Muted style={type.footnote}>{`You rated it ${item.myRating}`}</Muted> : null}
        <MarkupBadge item={item} serving={serving} />
      </View>
      <Text style={[type.figure, { color: c.ink }]}>{dollars(priceFor(item, serving))}</Text>
    </Pressable>
  );
}

/** "I'm having this": logged as a tasting at the list price (a new wine if it isn't in the catalog), then its page. */
async function haveIt(api: ReturnType<typeof useApi>, item: PickItem, serving: Serving) {
  try {
    const wineId = item.wineId ?? (await api.createWine({ producer: item.entry.producer, name: item.entry.name || item.entry.text, region: item.entry.region })).wine_id;
    const price = priceFor(item, serving);
    await api.addTasting({
      wineId,
      vintage: item.entry.vintage || null,
      pricePaid: price ? price / 100 : null,
      priceContext: 'restaurant',
      bottleMl: serving === 'glass' ? 150 : item.entry.bottleMl ?? 750,
      setting: 'restaurant',
      kind: 'tasted',
    });
    router.push(`/wine/${wineId}`);
  } catch (e) {
    Alert.alert("Couldn't log it", e instanceof Error ? e.message : String(e));
  }
}
