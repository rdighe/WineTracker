/**
 * Bring a CellarTracker account over (Welcome and Settings): sign in with the
 * CellarTracker handle and password - sent on to CellarTracker's export for
 * this one import and never kept - and choose what to bring. Or upload CSV
 * files exported from cellartracker.com instead, without sharing a password.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { newScanRef, scanAnswer } from '../lib/pendingScan';
import type { CtPart, CtSummary } from '../lib/types';
import { useApi } from '../lib/useApi';
import { CheckIcon } from './icons';
import { Button, Card, ErrorText, Heading, Label, Muted, space, type, useStyles, useTheme } from './ui';

const PARTS: { key: CtPart; title: string; detail: string }[] = [
  { key: 'collection', title: 'Your collection', detail: 'Every bottle in your cellars, with its location and bin' },
  { key: 'pending', title: 'On order', detail: "Bottles bought that haven't arrived" },
  { key: 'notes', title: 'Your tasting notes', detail: 'Scores become stars; notes stay private' },
  { key: 'history', title: 'What you drank', detail: 'Bottles marked consumed' },
  { key: 'wishlist', title: 'Wishlist', detail: 'Wines to try, into Saved' },
];
const PART_LABEL: Record<CtPart, string> = { collection: 'collection', pending: 'on order', notes: 'tasting notes', history: 'drunk', wishlist: 'wishlist' };

export function CellarTrackerImport({ bare, onDone }: { bare?: boolean; onDone?: (s: CtSummary) => void }) {
  const api = useApi();
  const { c, scheme } = useTheme();
  const s = useStyles();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [parts, setParts] = useState<CtPart[]>(['collection', 'pending', 'notes', 'history']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CtSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showFiles, setShowFiles] = useState(false);

  async function run(input: { handle?: string; password?: string; parts?: CtPart[]; files?: string[] }) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const ref = newScanRef();
      await api.importCellarTracker(input, ref);
      const r = await scanAnswer<CtSummary>(api, ref, { tooLong: 'The import is taking a while. It carries on: check your Cellar in a few minutes.' });
      setResult(r);
      // Forget the password as soon as it's been used.
      setPassword('');
      onDone?.(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function pickFiles() {
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets.length) return;
    const files = await Promise.all(res.assets.map((a) => (Platform.OS === 'web' && a.file ? a.file.text() : new File(a.uri).text())));
    await run({ files });
  }

  const toggle = (k: CtPart) => setParts(parts.includes(k) ? parts.filter((x) => x !== k) : [...parts, k]);
  const input = [s.input, { color: c.ink }];

  const body = (
    <View style={{ gap: space[4] }}>
      {bare ? null : <Heading>Import from CellarTracker</Heading>}
      <View style={{ gap: space[2] }}>
        <Text style={[type.subhead, { color: c.ink2 }]}>
          Sign in with your CellarTracker handle and password. They go straight to CellarTracker to fetch your data for this
          import, then they&apos;re forgotten: WineTracker never saves them. Everything stays in CellarTracker too.
        </Text>
        <Muted>Your handle is your CellarTracker username (not your email), shown at the top of cellartracker.com when you&apos;re signed in.</Muted>
      </View>
      <View style={{ gap: space[2] }}>
        <TextInput accessibilityLabel="CellarTracker handle" value={handle} onChangeText={setHandle} placeholder="Handle (not email)" placeholderTextColor={c.ink3}
          autoCapitalize="none" autoCorrect={false} textContentType="none" keyboardAppearance={scheme} style={input} />
        <TextInput accessibilityLabel="CellarTracker password" value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={c.ink3}
          secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="none" keyboardAppearance={scheme} style={input} />
      </View>
      <View style={{ gap: space[2] }}>
        <Label>What to bring</Label>
        {PARTS.map((p) => {
          const on = parts.includes(p.key);
          return (
            <Pressable key={p.key} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${p.title}. ${p.detail}`} onPress={() => toggle(p.key)}
              style={({ pressed }) => [{ flexDirection: 'row', gap: space[3], alignItems: 'center', minHeight: 44 }, pressed && { opacity: 0.7 }]}>
              <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: on ? 0 : 1.5, borderColor: c.borderControl, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on ? <CheckIcon color={c.onAccent} size={15} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.subhead, { fontWeight: '600', color: c.ink }]}>{p.title}</Text>
                <Text style={[type.footnote, { color: c.ink2 }]}>{p.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Button title="Import from CellarTracker" variant={bare ? 'primary' : 'secondary'} size={bare ? 'lg' : 'md'} busy={busy}
        disabled={!handle.trim() || !password || !parts.length} onPress={() => void run({ handle: handle.trim(), password, parts })} />
      {result ? (
        <View style={{ gap: 4 }}>
          <Text style={[type.subhead, { fontWeight: '600', color: c.positive }]}>
            {(Object.entries(result.parts) as [CtPart, { imported: number; bottles?: number }][])
              .map(([k, v]) => (k === 'collection' || k === 'pending' ? `${v.bottles ?? 0} bottles ${k === 'pending' ? 'on order' : ''}`.trim() : `${v.imported} ${PART_LABEL[k]}`)).join(' · ') || 'Nothing new to import'}
          </Text>
          <Muted>{`${result.matched} matched to our catalog${result.addedWines ? `, ${result.addedWines} added as new wines` : ''}. Importing again adds only what's new.`}</Muted>
        </View>
      ) : null}
      <ErrorText error={error} />
      {showFiles ? (
        <View style={{ gap: space[2] }}>
          <Label>Without your password</Label>
          <Muted>
            {'On cellartracker.com, open each list you want (your cellar, tasting notes, consumed, wishlist), choose Export and pick CSV, then upload the files here. Each is recognized by its columns.'}
          </Muted>
          <Button title="Upload CellarTracker CSV files" variant="secondary" size="md" busy={busy} onPress={() => void pickFiles()} />
        </View>
      ) : (
        <Button title="Rather not share your password?" variant="plain" size="sm" onPress={() => setShowFiles(true)} />
      )}
    </View>
  );
  return bare ? body : <Card>{body}</Card>;
}
