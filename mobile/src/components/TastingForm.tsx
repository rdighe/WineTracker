/** Price paid, rating, tags and notes for a tasting; used after a scan and from the wine page. */
import { useState } from 'react';
import type { TastingSetting } from '../lib/types';
import { Text, TextInput, View } from 'react-native';
import { useApi } from '../lib/useApi';
import { todayIso } from '../lib/format';
import { DateField } from './DateField';
import { Button, Card, Chip, ErrorText, Field, Label, Rating, Segmented, space, type, useStyles, useTheme } from './ui';

export type PriceContext = 'retail' | 'restaurant';
export type TastingKind = 'tasted' | 'cellar';

export function useTastingDraft(initialVintage?: string | null, initialKind: TastingKind = 'tasted') {
  const [kind, setKind] = useState<TastingKind>(initialKind);
  const [date, setDate] = useState(todayIso());
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso()) throw new Error('Date should be a past day, like 2026-03-07');
    // Cellar bottles and wine drunk at home were bought from a shop; a restaurant price is a restaurant price.
    const where: PriceContext = kind === 'cellar' || setting === 'home' ? 'retail' : setting === 'restaurant' ? 'restaurant' : context;
    const priceContext = p ? where : null;
    return {
      vintage: v || null, rating, notes: notes.trim(), tags, pricePaid: p, priceContext, kind,
      bottles: kind === 'cellar' ? bottles : null, setting: kind === 'cellar' ? null : setting, tastedOn: date,
    };
  }

  return { kind, setKind, date, setDate, bottles, setBottles, setting, setSetting, vintage, setVintage, rating, setRating, price, setPrice, context, setContext, tags, setTags, notes, setNotes, toTasting };
}

export type TastingDraft = ReturnType<typeof useTastingDraft>;

export function TastingFields({ draft, showVintage, suggestedTags = [] }: { draft: TastingDraft; showVintage?: boolean; suggestedTags?: string[] }) {
  const { c, scheme } = useTheme();
  const s = useStyles();
  const [tagInput, setTagInput] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(Boolean(draft.notes));
  const addTag = () => {
    const t = (tagInput ?? '').trim().toLowerCase();
    if (t && !draft.tags.includes(t)) draft.setTags([...draft.tags, t]);
    setTagInput(null);
  };

  return (
    <Card style={{ gap: space[5] }}>
      <Segmented
        options={[{ key: 'tasted', label: 'Tasted it' }, { key: 'cellar', label: 'In my cellar' }]}
        value={draft.kind}
        onChange={draft.setKind}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>{draft.kind === 'cellar' ? 'Rating (optional)' : 'Your rating'}</Label>
        <Rating value={draft.rating} onChange={draft.setRating} size="lg" />
      </View>
      {draft.kind === 'cellar' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>Bottles</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <Button title="−" variant="secondary" size="sm" accessibilityLabel="One bottle fewer" onPress={() => draft.setBottles(Math.max(1, draft.bottles - 1))} />
            <Text style={[type.headline, type.tabular, { color: c.ink, minWidth: 28, textAlign: 'center' }]} accessibilityLabel={`${draft.bottles} bottles`}>{draft.bottles}</Text>
            <Button title="+" variant="secondary" size="sm" accessibilityLabel="One bottle more" onPress={() => draft.setBottles(Math.min(9999, draft.bottles + 1))} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space[2] }}>
          <Label>Where</Label>
          <Segmented
            options={[{ key: 'home', label: 'At home' }, { key: 'restaurant', label: 'Restaurant' }, { key: 'other', label: 'Elsewhere' }]}
            value={draft.setting}
            onChange={draft.setSetting}
          />
        </View>
      )}
      <DateField label={draft.kind === 'cellar' ? 'Added on' : 'Tasted on'} value={draft.date} onChange={draft.setDate} />
      {showVintage ? (
        <Field label="Vintage" numeric value={draft.vintage} onChangeText={draft.setVintage} placeholder="2019 or NV" autoCapitalize="characters" maxLength={4} />
      ) : null}
      <View style={{ gap: 6 }}>
        <Label>{draft.kind === 'cellar' ? 'Price per bottle' : draft.setting === 'home' ? 'What the bottle cost' : 'What you paid'}</Label>
        <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
          <TextInput
            accessibilityLabel="What you paid"
            value={draft.price}
            onChangeText={draft.setPrice}
            placeholder="$0.00"
            placeholderTextColor={c.ink3}
            keyboardType="decimal-pad"
            keyboardAppearance={scheme}
            style={[s.input, type.tabular, { flex: 1, minWidth: 0 }]}
          />
          {draft.kind === 'tasted' && draft.setting === 'other' ? (
            <Segmented
              small
              options={[{ key: 'retail', label: 'Shop' }, { key: 'restaurant', label: 'Restaurant' }]}
              value={draft.context}
              onChange={draft.setContext}
            />
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
        {draft.tags.map((t) => (
          <Chip key={t} selected onPress={() => draft.setTags(draft.tags.filter((x) => x !== t))}>{`${t}  ×`}</Chip>
        ))}
        {tagInput === null ? (
          <Button title="Add tag" variant="secondary" size="sm" onPress={() => setTagInput('')} />
        ) : (
          <TextInput
            autoFocus
            accessibilityLabel="New tag"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTag}
            onBlur={addTag}
            placeholder="dark cherry"
            placeholderTextColor={c.ink3}
            autoCapitalize="none"
            returnKeyType="done"
            keyboardAppearance={scheme}
            style={[type.subhead, { minWidth: 120, height: 34, borderRadius: 999, borderWidth: 1, borderColor: c.focus, paddingHorizontal: space[3], color: c.ink }]}
          />
        )}
        {!noteOpen ? <Button title="Add note" variant="secondary" size="sm" onPress={() => setNoteOpen(true)} /> : null}
      </View>
      {suggestedTags.some((t) => !draft.tags.includes(t)) ? (
        <View style={{ gap: space[2] }}>
          <Label>Typical notes · tap to add</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestedTags.filter((t) => !draft.tags.includes(t)).map((t) => (
              <Chip key={t} small onPress={() => draft.setTags([...draft.tags, t])}>{`+ ${t}`}</Chip>
            ))}
          </View>
        </View>
      ) : null}
      {noteOpen ? (
        <Field label="Notes" value={draft.notes} onChangeText={draft.setNotes} placeholder="What stood out?" multiline style={{ height: 110, paddingTop: space[3], textAlignVertical: 'top' }} />
      ) : null}
    </Card>
  );
}

/** Stand-alone form (wine page): the fields plus a save button. */
export function TastingForm({ wineId, vintage, scanId, suggestedTags, kind, onSaved }: {
  wineId: number; vintage?: string | null; scanId?: number; suggestedTags?: string[]; kind?: TastingKind; onSaved: (kind: TastingKind) => void;
}) {
  const api = useApi();
  const draft = useTastingDraft(vintage, kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.addTasting({ wineId, scanId, ...draft.toTasting() });
      onSaved(draft.kind);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <TastingFields draft={draft} showVintage suggestedTags={suggestedTags} />
      <ErrorText error={error} />
      <Button title={draft.kind === 'cellar' ? 'Add to cellar' : 'Save tasting'} onPress={save} busy={busy} />
    </View>
  );
}
