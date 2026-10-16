/** Price paid, rating, tags and notes for a tasting; used after a scan and from the wine page. */
import { useState } from 'react';
import type { TastingSetting } from '../lib/types';
import { Text, TextInput, View } from 'react-native';
import { useApi } from '../lib/useApi';
import { Button, Card, Chip, ErrorText, Eyebrow, Field, RatingDots, Segmented, colors, fonts, styles } from './ui';

export type PriceContext = 'retail' | 'restaurant';
export type TastingKind = 'tasted' | 'cellar';

export function useTastingDraft(initialVintage?: string | null) {
  const [kind, setKind] = useState<TastingKind>('tasted');
  const [bottles, setBottles] = useState(1);
  const [setting, setSetting] = useState<TastingSetting>('home');
  const [vintage, setVintage] = useState(initialVintage ?? '');
  const [rating, setRating] = useState<number | null>(null);
  const [price, setPrice] = useState('');
  const [context, setContext] = useState<PriceContext>('retail');
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  /** The tasting fields for the API; throws on an invalid vintage or price. */
  function toTasting() {
    const v = vintage.trim().toUpperCase();
    if (v && !/^(1[89]\d\d|20\d\d|NV)$/.test(v)) throw new Error('Vintage should be a year or NV');
    const p = price.trim() ? Number(price.replace(/[$,\s]/g, '')) : null;
    if (p !== null && !(p > 0)) throw new Error('Price should be a number');
    // Cellar bottles and wine drunk at home were bought from a shop; a restaurant price is a restaurant price.
    const where: PriceContext = kind === 'cellar' || setting === 'home' ? 'retail' : setting === 'restaurant' ? 'restaurant' : context;
    const priceContext = p ? where : null;
    return {
      vintage: v || null, rating, notes: notes.trim(), tags, pricePaid: p, priceContext, kind,
      bottles: kind === 'cellar' ? bottles : null, setting: kind === 'cellar' ? null : setting,
    };
  }

  return { kind, setKind, bottles, setBottles, setting, setSetting, vintage, setVintage, rating, setRating, price, setPrice, context, setContext, tags, setTags, notes, setNotes, toTasting };
}

export type TastingDraft = ReturnType<typeof useTastingDraft>;

export function TastingFields({ draft, showVintage }: { draft: TastingDraft; showVintage?: boolean }) {
  const [tagInput, setTagInput] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(Boolean(draft.notes));
  const addTag = () => {
    const t = (tagInput ?? '').trim().toLowerCase();
    if (t && !draft.tags.includes(t)) draft.setTags([...draft.tags, t]);
    setTagInput(null);
  };

  return (
    <Card style={{ gap: 16 }}>
      <Segmented
        options={[{ key: 'tasted', label: 'Tasted it' }, { key: 'cellar', label: 'In my cellar' }]}
        value={draft.kind}
        onChange={draft.setKind}
      />
      {draft.kind === 'cellar' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Eyebrow>Bottles</Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Button title="−" variant="pill" style={{ borderColor: colors.line2, minWidth: 40, alignItems: 'center' }} onPress={() => draft.setBottles(Math.max(1, draft.bottles - 1))} />
            <Text style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.text, minWidth: 28, textAlign: 'center' }} accessibilityLabel={`${draft.bottles} bottles`}>{draft.bottles}</Text>
            <Button title="+" variant="pill" style={{ borderColor: colors.line2, minWidth: 40, alignItems: 'center' }} onPress={() => draft.setBottles(Math.min(9999, draft.bottles + 1))} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Eyebrow>Where</Eyebrow>
          <Segmented
            options={[{ key: 'home', label: 'At home' }, { key: 'restaurant', label: 'Restaurant' }, { key: 'other', label: 'Elsewhere' }]}
            value={draft.setting}
            onChange={draft.setSetting}
          />
        </View>
      )}
      {showVintage ? (
        <Field label="Vintage" mono value={draft.vintage} onChangeText={draft.setVintage} placeholder="2019 or NV" autoCapitalize="characters" maxLength={4} />
      ) : null}
      <View style={{ gap: 8 }}>
        <Eyebrow>{draft.kind === 'cellar' ? 'Price per bottle' : draft.setting === 'home' ? 'What the bottle cost' : 'What you paid'}</Eyebrow>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            accessibilityLabel="What you paid"
            value={draft.price}
            onChangeText={draft.setPrice}
            placeholder="$0.00"
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
            style={[styles.input, { flex: 1, minWidth: 0, fontFamily: fonts.mono }]}
          />
          {draft.kind === 'tasted' && draft.setting === 'other' ? (
            <Segmented
              options={[{ key: 'retail', label: 'Shop' }, { key: 'restaurant', label: 'Restaurant' }]}
              value={draft.context}
              onChange={draft.setContext}
            />
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Eyebrow>{draft.kind === 'cellar' ? 'Rating (optional)' : 'Your rating'}</Eyebrow>
        <RatingDots value={draft.rating} onChange={draft.setRating} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {draft.tags.map((t) => (
          <Chip key={t} tone="tag" onPress={() => draft.setTags(draft.tags.filter((x) => x !== t))}>{t}  ×</Chip>
        ))}
        {tagInput === null ? (
          <Button title="+ Tag" variant="pill" onPress={() => setTagInput('')} style={{ borderStyle: 'dashed', borderColor: colors.line2 }} />
        ) : (
          <TextInput
            autoFocus
            accessibilityLabel="New tag"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTag}
            onBlur={addTag}
            placeholder="dark cherry"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            returnKeyType="done"
            style={{ minWidth: 110, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.line2, paddingHorizontal: 12, color: colors.text, fontFamily: fonts.regular, fontSize: 12 }}
          />
        )}
        {!noteOpen ? <Button title="+ Note" variant="pill" onPress={() => setNoteOpen(true)} style={{ borderStyle: 'dashed', borderColor: colors.line2 }} /> : null}
      </View>
      {noteOpen ? (
        <Field label="Notes" value={draft.notes} onChangeText={draft.setNotes} placeholder="What stood out?" multiline style={{ height: 96, paddingTop: 12, textAlignVertical: 'top' }} />
      ) : null}
    </Card>
  );
}

/** Stand-alone form (wine page): the fields plus a save button. */
export function TastingForm({ wineId, vintage, scanId, onSaved }: {
  wineId: number; vintage?: string | null; scanId?: number; onSaved: () => void;
}) {
  const api = useApi();
  const draft = useTastingDraft(vintage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.addTasting({ wineId, scanId, ...draft.toTasting() });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <TastingFields draft={draft} showVintage />
      <ErrorText error={error} />
      <Button title={draft.kind === 'cellar' ? 'Add to cellar' : 'Save tasting'} onPress={save} busy={busy} />
    </View>
  );
}
