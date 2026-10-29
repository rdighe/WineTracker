/**
 * Picks: photograph a restaurant wine list (?kind=list, a page per photo) or
 * a store shelf (?kind=shelf) and see its wines ranked for your palate, or
 * open a saved one (?id=). The phone reads a list's text (lib/wineList.ts);
 * the server reads it into wines, matches and scores them (src/picks/). A
 * list or shelf can be saved, with its photos, to the Lists tab.
 */
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, Text, View } from 'react-native';
import { PhotosIcon, ScanIcon } from '../components/icons';
import { PhotoThumb, PhotoViewer } from '../components/PhotoViewer';
import { PickPhoto } from '../components/PickPhoto';
import { PickResults, type Kind } from '../components/PickResults';
import { Button, Card, ErrorText, Heading, IconButton, Muted, Screen, Title, radius, space, type, useTheme } from '../components/ui';
import { shortDate } from '../lib/format';
import { LINEUP_MAX_SIDE, prepareLabelPhoto } from '../lib/photo';
import type { PickResult } from '../lib/types';
import { ApiError } from '../lib/api';
import { newScanRef, scanAnswer, Superseded } from '../lib/pendingScan';
import { useApi } from '../lib/useApi';
import { readListPhoto } from '../lib/wineList';

/** A photo taken for this list or shelf, and the text read off it. */
interface Page { uri: string; width: number; height: number; text: string }
type Opened = PickResult & { name?: string; saved?: boolean; photos?: number };

/** Saved photos: shrunk, enough to read the list again later. */
const SAVED_PHOTO_SIDE = 1600;

export default function PicksScreen() {
  const api = useApi();
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const savedId = params.id ? Number(params.id) : null;
  const [kind, setKind] = useState<Kind>(params.kind === 'shelf' ? 'shelf' : 'list');
  const [pages, setPages] = useState<Page[]>([]);
  const [result, setResult] = useState<Opened | null>(null);
  const [status, setStatus] = useState<string | null>(savedId ? 'Opening…' : null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  // A saved list: ranked again for the palate as it is now.
  useEffect(() => {
    if (!savedId) return;
    let cancelled = false;
    api.openPick(savedId).then(
      (r) => {
        if (cancelled) return;
        setKind(r.kind);
        setResult(r);
        setStatus(null);
      },
      (e) => {
        if (cancelled) return;
        setError(e);
        setStatus(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api, savedId]);

  // The photos so far, and the result shown, as of now (read by work that outlives a render).
  const pagesNow = useRef<Page[]>([]);
  const resultNow = useRef<Opened | null>(null);
  useEffect(() => {
    resultNow.current = result;
  }, [result]);
  // The evaluation running: only the latest one's answer is shown (adding a page starts a new one).
  const [running, setRunning] = useState<string | null>(null);
  const runningNow = useRef<string | null>(null);
  // Leaving this screen: stop asking about the evaluation under way.
  useEffect(() => () => {
    runningNow.current = null;
  }, []);

  async function addPhoto(fromCamera: boolean) {
    setError(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', fromCamera ? 'Allow camera access to take the photo.' : 'Allow photo access to choose a photo.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, allowsMultipleSelection: !fromCamera && kind === 'list', selectionLimit: 6 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets.length) return;
    try {
      if (kind === 'shelf') {
        const asset = res.assets[0]!;
        setStatus('Reading the shelf…');
        const rows = (await readListPhoto(asset.uri)) ?? [];
        const photo = await prepareLabelPhoto(asset, LINEUP_MAX_SIDE);
        pagesNow.current = [{ ...asset, text: rows.join('\n') }];
        setPages(pagesNow.current);
        setResult(null);
        setStatus(null);
        void evaluate((ref) => api.pickFromShelf(photo, rows.join('\n'), ref));
        return;
      }
      for (const asset of res.assets) {
        setStatus(`Reading page ${pagesNow.current.length + 1}…`);
        const rows = await readListPhoto(asset.uri);
        if (!rows) throw new Error('Wine lists can be read in the iPhone app.');
        if (!rows.length) throw new Error('No text found in that photo. Try again closer, with the page flat and well lit.');
        pagesNow.current = [...pagesNow.current, { ...asset, text: rows.join('\n') }];
        setPages(pagesNow.current);
      }
      setStatus(null);
      const texts = pagesNow.current.map((p) => p.text);
      void evaluate((ref) => api.pickFromList(texts, ref));
    } catch (e) {
      setError(e);
      setStatus(null);
    }
  }

  /**
   * Rank the list (or shelf) on the server, as a job: switching apps or a
   * dropped connection loses nothing, the answer is collected when back.
   * A newer evaluation (a page added meanwhile) replaces this one.
   */
  async function evaluate(start: (ref: string) => Promise<unknown>) {
    const ref = newScanRef();
    runningNow.current = ref;
    setRunning(ref);
    const wanted = () => runningNow.current === ref;
    try {
      // Sending is quick, but may meet a dropped connection: try again (the same ref runs once).
      for (let attempt = 1; ; attempt++) {
        try {
          await start(ref);
          break;
        } catch (e) {
          if (e instanceof ApiError || attempt >= 5 || !wanted()) throw e;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      const next: Opened = await scanAnswer<PickResult>(api, ref, { wanted, tooLong: 'Reading the list is taking too long. Try again.' });
      // Already saved: the saved list gets the new page too.
      const prev = resultNow.current;
      if (prev?.saved && prev.name && prev.pickId !== next.pickId) {
        await api.savePick(next.pickId, prev.name, await savedPhotos(pagesNow.current));
        await api.deletePick(prev.pickId).catch(() => {});
        Object.assign(next, { name: prev.name, saved: true, photos: pagesNow.current.length });
      }
      if (!wanted()) return;
      setResult(next);
    } catch (e) {
      if (e instanceof Superseded || !wanted()) return;
      setError(e);
    } finally {
      if (wanted()) {
        runningNow.current = null;
        setRunning(null);
      }
    }
  }

  // A new scan: straight to the camera, once the screen has slid in.
  const started = useRef(false);
  const addRef = useRef(addPhoto);
  useEffect(() => {
    addRef.current = addPhoto;
  });
  useEffect(() => {
    if (started.current || savedId) return;
    started.current = true;
    const t = setTimeout(() => void addRef.current(true), 350);
    return () => clearTimeout(t);
  }, [savedId]);

  async function save(name: string) {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const photos = await savedPhotos(pages);
      await api.savePick(result.pickId, name, photos);
      setResult({ ...result, name, saved: true, photos: photos.length });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  function askToSave() {
    const fallback = `${kind === 'shelf' ? 'Shelf' : 'Wine list'} · ${shortDate(new Date().toISOString().slice(0, 10))}`;
    if (Platform.OS !== 'ios') return void save(result?.name || fallback);
    Alert.prompt(result?.saved ? 'Rename' : 'Save this list', 'A name to find it by, like the restaurant or shop.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: (name?: string) => void save(name?.trim() || fallback) },
    ], 'plain-text', result?.name || fallback);
  }

  function confirmDelete() {
    if (!savedId) return;
    Alert.alert('Delete this saved list?', 'Its photos go too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void api.deletePick(savedId).then(close, setError),
      },
    ]);
  }

  if (result && !status && !running) {
    const photoCount = savedId ? result.photos ?? 0 : 0;
    return (
      <PickResults
        kind={kind}
        result={result}
        title={result.name || undefined}
        onBack={close}
        error={error}
        header={savedId ? (
          photoCount ? <SavedPhotos pickId={savedId} count={photoCount} /> : null
        ) : pages.length ? <NewPhotos pages={pages} /> : null}
        footer={
          <View style={{ gap: space[2] }}>
            <Button title={result.saved ? 'Rename' : 'Save'} variant={result.saved ? 'secondary' : 'primary'} busy={saving} onPress={askToSave} />
            {!savedId ? (
              <Button title={kind === 'shelf' ? 'Scan another shelf' : 'Add another page'} variant="secondary" onPress={() => void addPhoto(true)} />
            ) : (
              <Button title="Delete" variant="plain" onPress={confirmDelete} />
            )}
          </View>
        }
      />
    );
  }

  // Evaluating: the photos so far, and (for a list) more pages can be added meanwhile.
  if (running || (status && pages.length)) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title>{kind === 'shelf' ? 'Store shelf' : 'Wine list'}</Title>
          <CloseButton />
        </View>
        {pages.length ? <NewPhotos pages={pages} /> : null}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <ActivityIndicator />
            <Heading style={{ flex: 1 }}>
              {status ?? (kind === 'list' && pages.length > 1 ? `Finding the best wines on ${pages.length} pages…` : 'Finding the best wines for you…')}
            </Heading>
          </View>
          <Muted>{kind === 'list' ? 'Add more pages while you wait. You can switch apps; it keeps going.' : 'You can switch apps; it keeps going.'}</Muted>
          {kind === 'list' ? (
            <View style={{ gap: space[2] }}>
              <Button title="Add another page" variant="secondary" disabled={Boolean(status)} icon={(color) => <ScanIcon color={color} size={20} />} onPress={() => addPhoto(true)} />
              <Button title="Choose photos" variant="plain" disabled={Boolean(status)} icon={(color) => <PhotosIcon color={color} size={20} />} onPress={() => addPhoto(false)} />
            </View>
          ) : null}
        </Card>
        <ErrorText error={error} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title>{kind === 'shelf' ? 'Store shelf' : 'Wine list'}</Title>
        <CloseButton />
      </View>
      <Card>
        <Heading>{status ?? (kind === 'shelf' ? 'Photograph the shelf' : 'Photograph the wine list')}</Heading>
        {!status ? (
          <>
            <Muted>
              {kind === 'shelf'
                ? 'Get the bottles and the price tags below them in one photo, straight on.'
                : 'One page per photo, flat and well lit, prices included. You can add more pages after.'}
            </Muted>
            <View style={{ gap: space[2] }}>
              <Button title="Take a photo" icon={(color) => <ScanIcon color={color} size={20} />} onPress={() => addPhoto(true)} />
              <Button title={kind === 'shelf' ? 'Choose a photo' : 'Choose photos'} variant="secondary" icon={(color) => <PhotosIcon color={color} size={20} />} onPress={() => addPhoto(false)} />
            </View>
          </>
        ) : null}
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}

async function savedPhotos(pages: Page[]): Promise<{ base64: string; mimeType: string }[]> {
  const out = [];
  for (const p of pages) {
    const ph = await prepareLabelPhoto(p, SAVED_PHOTO_SIDE);
    out.push({ base64: ph.base64, mimeType: ph.mimeType });
  }
  return out;
}

/** The photos just taken, in a row. */
function NewPhotos({ pages }: { pages: Page[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
        {pages.map((p, i) => (
          <PhotoThumb key={`${p.uri}-${i}`} label={`Photo ${i + 1}`} onPress={() => setOpen(i)}>
            <Image source={{ uri: p.uri }} style={{ width: 120, height: 160, borderRadius: radius.sm }} resizeMode="cover" />
          </PhotoThumb>
        ))}
      </ScrollView>
      <PhotoViewer photos={pages.map((p) => ({ uri: p.uri }))} index={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** A saved list's photos, in a row. */
function SavedPhotos({ pickId, count }: { pickId: number; count: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
        {Array.from({ length: count }, (_, n) => (
          <PhotoThumb key={n} label={`Photo ${n + 1}`} onPress={() => setOpen(n)}>
            <PickPhoto pickId={pickId} n={n} style={{ width: 120, height: 160, borderRadius: radius.sm }} />
          </PhotoThumb>
        ))}
      </ScrollView>
      <PhotoViewer photos={Array.from({ length: count }, (_, n) => ({ pickId, n }))} index={open} onClose={() => setOpen(null)} />
    </>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/lists');
}

function CloseButton() {
  const { c } = useTheme();
  return (
    <IconButton label="Close" onPress={close} size={36}>
      <Text style={[type.headline, { color: c.ink2, lineHeight: 20 }]}>×</Text>
    </IconButton>
  );
}
