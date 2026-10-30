/** Settings: pick a Vivino export (CSV) and import its ratings. */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import type { ImportSummary } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Button, Card, ErrorText, Heading, Muted, type, useTheme } from './ui';

/** On a card (Settings), or bare (Welcome, which explains it itself). */
function Wrap({ bare, children }: { bare?: boolean; children: ReactNode }) {
  return bare ? <View style={{ gap: 12 }}>{children}</View> : <Card>{children}</Card>;
}

/** Pick a Vivino export (CSV) and import its ratings. */
export function VivinoImport({ onDone, bare }: { onDone?: (summary: ImportSummary) => void; bare?: boolean }) {
  const api = useApi();
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function pick() {
    setError(null);
    setResult(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const csv = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
      const summary = await api.importVivino(csv);
      setResult(summary);
      onDone?.(summary);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Wrap bare={bare}>
      {bare ? null : <Heading>Import from Vivino</Heading>}
      <VivinoSteps />
      <Button title="Choose Vivino CSV" variant={bare ? 'primary' : 'secondary'} size={bare ? 'lg' : 'md'} busy={busy} onPress={pick} />
      {result ? (
        <View style={{ gap: 4 }}>
          <Text style={[type.subhead, { fontWeight: '600', color: c.positive }]}>
            Imported {result.imported} {result.imported === 1 ? 'wine' : 'wines'}
            {result.alreadyImported ? ` · ${result.alreadyImported} already here` : ''}
          </Text>
          <Muted>
            {result.matched} matched to our catalog{result.addedWines ? `, ${result.addedWines} added as new wines` : ''}.
          </Muted>
          {result.addedNames.length ? <Muted>New: {result.addedNames.slice(0, 5).join(' · ')}{result.addedNames.length > 5 ? ' …' : ''}</Muted> : null}
          {result.missingColumns.includes('rating') ? <Muted style={{ color: c.negative }}>No rating column found, so wines came in unrated.</Muted> : null}
        </View>
      ) : null}
      <ErrorText error={error} />
    </Wrap>
  );
}

/** How to get a Vivino export, step by step. */
export function VivinoSteps() {
  const { c } = useTheme();
  const steps = [
    'In Vivino (the app or vivino.com), open your profile, then Settings.',
    'Under Privacy (or Account), choose to request a copy of your data. Vivino emails a download link, usually within a day.',
    'Download the file on this phone (or AirDrop it here) and unzip it if it is a .zip.',
    "Tap Choose Vivino CSV and pick the wine list file (its name mentions wines or ratings). Importing the same file again adds nothing new.",
  ];
  return (
    <View style={{ gap: 6 }}>
      {steps.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={[type.footnote, type.tabular, { color: c.accent, fontWeight: '700', width: 16 }]}>{i + 1}</Text>
          <Text style={[type.footnote, { color: c.ink2, flex: 1 }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}
