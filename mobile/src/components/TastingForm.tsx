/** Rating, notes and price paid for a wine; used after a scan and from the wine page. */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApi } from '../lib/useApi';
import { Button, Card, ErrorText, Field, RatingPicker, colors, styles } from './ui';

export function TastingForm({ wineId, vintage: initialVintage, scanId, onSaved }: {
  wineId: number; vintage?: string | null; scanId?: number; onSaved: () => void;
}) {
  const api = useApi();
  const [vintage, setVintage] = useState(initialVintage ?? '');
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [price, setPrice] = useState('');
  const [context, setContext] = useState<'retail' | 'restaurant'>('restaurant');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const v = vintage.trim().toUpperCase();
      if (v && !/^(1[89]\d\d|20\d\d|NV)$/.test(v)) throw new Error('Vintage should be a year or NV');
      const p = price.trim() ? Number(price.replace(/[$,]/g, '')) : null;
      if (p !== null && !(p > 0)) throw new Error('Price should be a number');
      await api.addTasting({
        wineId, scanId, vintage: v || null, rating, notes: notes.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean), pricePaid: p, priceContext: p ? context : null,
      });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={styles.h2}>Log this tasting</Text>
      <RatingPicker value={rating} onChange={setRating} />
      <Field label="Vintage" value={vintage} onChangeText={setVintage} placeholder="2019 or NV" autoCapitalize="characters" maxLength={4} />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="What stood out?" multiline />
      <Field label="Tags (comma separated)" value={tags} onChangeText={setTags} placeholder="dark cherry, silky tannins" autoCapitalize="none" />
      <Field label="Price paid (bottle)" value={price} onChangeText={setPrice} placeholder="$" keyboardType="decimal-pad" />
      <View style={styles.row}>
        {(['restaurant', 'retail'] as const).map((c) => (
          <Pressable key={c} onPress={() => setContext(c)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: context === c ? colors.wine : colors.wineLight }}>
            <Text style={{ color: context === c ? '#fff' : colors.wine }}>{c === 'restaurant' ? 'Restaurant' : 'Shop'}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText error={error} />
      <Button title="Save tasting" onPress={save} busy={busy} />
    </Card>
  );
}
