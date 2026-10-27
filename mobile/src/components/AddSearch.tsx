/**
 * Add Wine's search: find a wine in the catalog (then add it to the cellar or
 * log a tasting from its page), or add one by hand when it isn't there.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import type { Candidate } from '../lib/types';
import { useApi } from '../lib/useApi';
import { SearchIcon } from './icons';
import { Button, Card, ErrorText, Eyebrow, Field, Muted, colors, fonts } from './ui';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** The search field; on the Add Wine page it sits next to the photo-library button. */
export function SearchBar({ value, onChangeText, onFocus, autoFocus }: { value: string; onChangeText: (q: string) => void; onFocus?: () => void; autoFocus?: boolean }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
      <SearchIcon color={colors.muted} size={20} />
      <TextInput
        accessibilityLabel="Search or add manually"
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        autoFocus={autoFocus}
        returnKeyType="search"
        placeholder="Search or add manually"
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, minHeight: 44 }, webNoOutline]}
      />
    </View>
  );
}

/** Catalog matches for the query (as you type), then "add it manually". */
export function SearchResults({ query }: { query: string }) {
  const api = useApi();
  // Results remember their query, so stale ones never show for newer text.
  const [found, setFound] = useState<{ q: string; results: Candidate[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [manual, setManual] = useState(false);
  const q = query.trim();
  const results = q.length >= 2 && found?.q === q ? found.results : null;

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(q).then(
        (r) => !cancelled && (setFound({ q, results: r.results }), setError(null)),
        (e) => !cancelled && setError(e)
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, q]);

  return (
    <View style={{ gap: 10 }}>
      {results?.map((r) => (
        <Pressable key={r.wineId} accessibilityRole="button" onPress={() => router.push(`/wine/${r.wineId}`)} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
          <Card style={{ padding: 16, gap: 4 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.text }}>{r.displayName}</Text>
            <Muted style={{ fontSize: 12 }}>{[r.region, r.country].filter(Boolean).join(' · ') || ' '}</Muted>
          </Card>
        </Pressable>
      ))}
      {results && !results.length ? <Muted>No matches in the catalog.</Muted> : null}
      <ErrorText error={error} />
      {manual ? (
        <ManualAdd initial={q} />
      ) : (
        <Button title={q.length >= 2 ? "Can't find it? Add it manually" : 'Add a wine manually'} variant="secondary" onPress={() => setManual(true)} />
      )}
    </View>
  );
}

/** A wine typed in by hand: created in the catalog, then added to the cellar or logged as a tasting. */
function ManualAdd({ initial }: { initial: string }) {
  const api = useApi();
  const [producer, setProducer] = useState(initial);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [vintage, setVintage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function add(kind: 'cellar' | 'tasted') {
    setError(null);
    const v = vintage.trim().toUpperCase();
    if (v && !/^(1[89]\d\d|20\d\d|NV)$/.test(v)) return setError(new Error('Vintage should be a year or NV'));
    if (!producer.trim() && !name.trim()) return setError(new Error('Enter the producer or the wine'));
    setBusy(true);
    try {
      const wine = await api.createWine({ producer: producer.trim(), name: name.trim(), region: region.trim() || undefined });
      router.push(`/wine/${wine.wine_id}?add=${kind}&vintage=${encodeURIComponent(v)}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Eyebrow>Add a wine manually</Eyebrow>
      <Field label="Producer" value={producer} onChangeText={setProducer} placeholder="Château Lafleur" />
      <Field label="Wine" value={name} onChangeText={setName} placeholder="Les Pensées (if it has a name)" />
      <Field label="Region" value={region} onChangeText={setRegion} placeholder="Pomerol" />
      <Field label="Vintage" mono value={vintage} onChangeText={setVintage} placeholder="2019 or NV" autoCapitalize="characters" maxLength={4} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Add to cellar" busy={busy} onPress={() => add('cellar')} style={{ flex: 1 }} />
        <Button title="Log tasting" variant="secondary" busy={busy} onPress={() => add('tasted')} style={{ flex: 1 }} />
      </View>
      <ErrorText error={error} />
    </Card>
  );
}
