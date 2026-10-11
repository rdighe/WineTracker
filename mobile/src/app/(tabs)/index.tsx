/**
 * Scan: photo of a label -> API reads and matches it -> confirm the wine ->
 * log the tasting.
 */
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { TastingForm } from '../../components/TastingForm';
import { Button, Card, ErrorText, Field, Muted, colors, styles } from '../../components/ui';
import { ApiError } from '../../lib/api';
import type { ScanResult } from '../../lib/types';
import { useApi } from '../../lib/useApi';

type Step =
  | { kind: 'idle' }
  | { kind: 'scanning'; uri: string }
  | { kind: 'review'; uri: string; scan: ScanResult }
  | { kind: 'log'; uri: string; scan: ScanResult; wineId: number; name: string };

export default function ScanScreen() {
  const api = useApi();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);
  const [newWine, setNewWine] = useState({ producer: '', name: '', region: '' });
  const [busy, setBusy] = useState(false);

  async function pick(fromCamera: boolean) {
    setError(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', fromCamera ? 'Allow camera access to scan labels.' : 'Allow photo access to choose a label photo.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: false };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setStep({ kind: 'scanning', uri: asset.uri });
    try {
      const scan = await api.scan(asset);
      setNewWine({ producer: scan.read.producer, name: scan.read.name, region: scan.read.region });
      setStep({ kind: 'review', uri: asset.uri, scan });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? new Error('Label reading is not set up on the server yet.') : e);
      setStep({ kind: 'idle' });
    }
  }

  async function confirm(choice: { wineId: number } | { newWine: typeof newWine }) {
    if (step.kind !== 'review') return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.confirmScan(step.scan.scanId, choice);
      setStep({ kind: 'log', uri: step.uri, scan: step.scan, wineId: r.wineId, name: r.wine.display_name });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {step.kind === 'idle' && (
        <Card>
          <Text style={styles.title}>Scan a label</Text>
          <Muted>Take a clear, straight-on photo of the front label.</Muted>
          <Button title="Take photo" onPress={() => pick(true)} />
          <Button title="Choose from photos" variant="secondary" onPress={() => pick(false)} />
        </Card>
      )}
      {step.kind !== 'idle' && <Image source={{ uri: step.uri }} style={{ width: '100%', height: 220, borderRadius: 12 }} resizeMode="cover" />}
      {step.kind === 'scanning' && <Muted>Reading the label…</Muted>}

      {step.kind === 'review' && (
        <>
          <Card>
            <Text style={styles.h2}>We read</Text>
            <Text>{[step.scan.read.producer, step.scan.read.name, step.scan.vintage].filter(Boolean).join(' · ') || 'Nothing legible'}</Text>
            {step.scan.read.region ? <Muted>{step.scan.read.region}</Muted> : null}
          </Card>
          {step.scan.candidates.length > 0 && (
            <Card>
              <Text style={styles.h2}>{step.scan.outcome === 'auto' ? 'Is this it?' : 'Which wine is it?'}</Text>
              {step.scan.candidates.map((c, i) => (
                <Pressable
                  key={c.wineId}
                  onPress={() => confirm({ wineId: c.wineId })}
                  style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: colors.border }}
                >
                  <Text style={{ fontWeight: '600', color: colors.text }}>{c.displayName}</Text>
                  <Muted>{[c.region, c.country].filter(Boolean).join(', ')}</Muted>
                </Pressable>
              ))}
            </Card>
          )}
          <Card>
            <Text style={styles.h2}>{step.scan.candidates.length ? 'None of these? Add it' : 'Add this wine'}</Text>
            <Field label="Producer" value={newWine.producer} onChangeText={(producer) => setNewWine({ ...newWine, producer })} />
            <Field label="Wine" value={newWine.name} onChangeText={(name) => setNewWine({ ...newWine, name })} />
            <Field label="Region" value={newWine.region} onChangeText={(region) => setNewWine({ ...newWine, region })} />
            <Button title="Add wine" busy={busy} variant="secondary" onPress={() => confirm({ newWine })} />
          </Card>
        </>
      )}

      {step.kind === 'log' && (
        <>
          <Card>
            <Text style={styles.h2}>{step.name}</Text>
            <Button title="See prices" variant="secondary" onPress={() => router.push(`/wine/${step.wineId}`)} />
          </Card>
          <TastingForm
            wineId={step.wineId}
            vintage={step.scan.vintage}
            scanId={step.scan.scanId}
            onSaved={() => {
              setStep({ kind: 'idle' });
              router.push('/tastings');
            }}
          />
        </>
      )}
      <ErrorText error={error} />
      {step.kind !== 'idle' && step.kind !== 'scanning' && (
        <View>
          <Button title="Start over" variant="secondary" onPress={() => setStep({ kind: 'idle' })} />
        </View>
      )}
    </ScrollView>
  );
}
