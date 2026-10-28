/** Settings: pick a Vivino export (CSV) and import its ratings. */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import type { ImportSummary } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Button, Card, ErrorText, Heading, Muted, type, useTheme } from './ui';

/** Pick a Vivino export (CSV) and import its ratings. */
export function VivinoImport({ onDone }: { onDone?: () => void }) {
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
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Heading>Import from Vivino</Heading>
      <Muted>
        Request a copy of your data from Vivino (in the app&apos;s account or privacy settings), then pick the wine list CSV from the download. Ratings, reviews and dates come across; importing the same file again adds nothing.
      </Muted>
      <Button title="Choose Vivino CSV" variant="secondary" size="md" busy={busy} onPress={pick} />
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
    </Card>
  );
}
