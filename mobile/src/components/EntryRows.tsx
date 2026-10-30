/**
 * A wine's cellar entries and tastings, each editable in place: bottles up
 * and down, dates changed, ratings changed, entries removed - and Edit, to
 * fix anything entered wrong (vintage, bottles, price, date, notes, or the
 * wine itself). Shown on My wines and on the wine's own page.
 */
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { dollars, shortDate, wineTitle } from '../lib/format';
import type { Candidate, Tasting } from '../lib/types';
import { useApi } from '../lib/useApi';
import { SearchBar } from './AddSearch';
import { DateField } from './DateField';
import { Button, ErrorText, Field, Label, Muted, PriceDelta, Rating, radius, space, type, useTheme } from './ui';

export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ])
  );
}

export function Badge({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
      <Text style={[type.footnote, { fontWeight: '500', color: c.ink2 }]}>{children}</Text>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Label>{title}</Label>
      {children}
    </View>
  );
}

/** Pick a new date for an entry, then save it. */
function DateEdit({ t, onChanged, label }: { t: Tasting; onChanged: () => Promise<void>; label: string }) {
  const api = useApi();
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(t.tasted_on);
  const [error, setError] = useState<unknown>(null);
  if (!editing) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${shortDate(t.tasted_on)}, change date`} onPress={() => setEditing(true)} hitSlop={6}>
        <Text style={[type.footnote, { color: c.ink2 }]}>
          {label} {shortDate(t.tasted_on)} <Text style={{ color: c.accent, fontWeight: '600' }}>· Change</Text>
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: space[2] }}>
      <DateField label={label} value={date} onChange={setDate} />
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button
          title="Save date"
          variant="tinted"
          size="sm"
          onPress={async () => {
            try {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a date like 2026-03-07');
              await api.updateTasting(t.tasting_id, { tastedOn: date });
              setEditing(false);
              await onChanged();
            } catch (e) {
              setError(e);
            }
          }}
        />
        <Button title="Cancel" variant="secondary" size="sm" onPress={() => { setDate(t.tasted_on); setEditing(false); }} />
      </View>
      <ErrorText error={error} />
    </View>
  );
}

export function CellarRow({ t, onChanged }: { t: Tasting; onChanged: () => Promise<void> }) {
  const api = useApi();
  const { c } = useTheme();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e);
    }
  };
  const n = t.bottles ?? 1;
  const [editing, setEditing] = useState(false);
  // A shared cellar you can only look at: no changes.
  const canEdit = t.can_edit !== false;
  const places = t.places ?? [];
  const where = [
    places.length === 1 ? `${places[0]!.rack}, row ${places[0]!.row + 1}, place ${places[0]!.col + 1}` : places.length ? `${places.length} on ${[...new Set(places.map((p) => p.rack))].join(', ')}` : '',
    t.added_by ? `Added by ${t.added_by}` : '',
  ].filter(Boolean).join(' · ');
  if (editing) return <EditEntry t={t} onClose={() => setEditing(false)} onChanged={onChanged} />;
  return (
    <View style={{ gap: 6, paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1, flexWrap: 'wrap' }}>
          <Text style={[type.headline, type.tabular, { color: c.ink }]}>{t.vintage_key ?? 'NV'}</Text>
          <Badge>{`${n} ${n === 1 ? 'bottle' : 'bottles'}`}</Badge>
          {t.paid_750_cents ? <Muted style={type.tabular}>paid {dollars(t.price_paid_cents)}</Muted> : null}
          <PriceDelta paid={t.paid_750_cents} now={t.market_now_cents} percentOnly />
        </View>
        {canEdit ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Button title="−" variant="secondary" size="sm" accessibilityLabel="One bottle fewer" onPress={() => run(() => (n > 1 ? api.updateTasting(t.tasting_id, { bottles: n - 1 }) : Promise.resolve()))} />
            <Button title="+" variant="secondary" size="sm" accessibilityLabel="One bottle more" onPress={() => run(() => api.updateTasting(t.tasting_id, { bottles: n + 1 }))} />
          </View>
        ) : null}
      </View>
      {where ? <Muted>{where}</Muted> : null}
      {canEdit ? <DateEdit t={t} onChanged={onChanged} label="Added" /> : null}
      {t.rating != null || t.notes ? <Muted>{[t.rating != null ? `Rated ${t.rating}` : '', t.notes].filter(Boolean).join(' · ')}</Muted> : null}
      {canEdit ? <View style={{ flexDirection: 'row', gap: space[4], flexWrap: 'wrap' }}>
      <Button title="Edit" variant="plain" size="sm" style={{ paddingHorizontal: 0 }} onPress={() => setEditing(true)} />
      {t.cellar_id ? (
        <Button title={places.length ? 'Move on the rack' : 'Put on a rack'} variant="plain" size="sm" style={{ paddingHorizontal: 0 }} onPress={() => router.push(`/racks?cellar=${t.cellar_id}`)} />
      ) : null}
      <Button
        title="Remove from cellar"
        variant="plain"
        size="sm"
        style={{ paddingHorizontal: 0 }}
        onPress={async () => {
          const ok = await confirm(
            'Remove from your cellar?',
            `${t.vintage_key ?? 'NV'}, ${n} ${n === 1 ? 'bottle' : 'bottles'}. Your tastings of this wine stay under Tasted.`,
            'Remove'
          );
          if (ok) await run(() => api.removeFromCellar(t.tasting_id));
        }}
      />
      </View> : null}
      <ErrorText error={error} />
    </View>
  );
}

const SETTING_LABEL = { home: 'At home', restaurant: 'Restaurant', other: 'Elsewhere' } as const;

export function TastingRow({ t, onChanged }: { t: Tasting; onChanged: () => Promise<void> }) {
  const api = useApi();
  const { c } = useTheme();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e);
    }
  };
  const [editing, setEditing] = useState(false);
  if (editing) return <EditEntry t={t} onClose={() => setEditing(false)} onChanged={onChanged} />;
  return (
    <View style={{ gap: 6, paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
        <Text style={[type.headline, type.tabular, { color: c.ink }]}>{t.vintage_key ?? 'NV'}</Text>
        {t.kind === 'cellar' ? <Badge>{`Cellar · ${t.bottles ?? 1}`}</Badge> : t.setting ? <Badge>{SETTING_LABEL[t.setting]}</Badge> : null}
        {t.price_paid_cents ? <Muted style={type.tabular}>{dollars(t.price_paid_cents)}{t.price_context === 'restaurant' ? ' (restaurant)' : ''}</Muted> : null}
      </View>
      <DateEdit t={t} onChanged={onChanged} label={t.kind === 'cellar' ? 'Added' : 'Tasted'} />
      <Rating value={t.rating} size="md" onChange={(rating) => run(() => api.updateTasting(t.tasting_id, { rating }))} showValue />
      {t.notes ? <Text style={[type.body, { color: c.ink }]}>{t.notes}</Text> : null}
      {t.tags?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {t.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
        </View>
      ) : null}
      {t.kind === 'cellar' ? (
        <Muted>Rated when added to your cellar.</Muted>
      ) : (
        <View style={{ flexDirection: 'row', gap: space[4] }}>
        <Button title="Edit" variant="plain" size="sm" style={{ paddingHorizontal: 0 }} onPress={() => setEditing(true)} />
        <Button
          title="Delete tasting"
          variant="plain"
          size="sm"
          style={{ paddingHorizontal: 0 }}
          onPress={async () => {
            if (await confirm('Delete this tasting?', `${shortDate(t.tasted_on)}${t.rating != null ? `, rated ${t.rating}` : ''}. This can't be undone.`, 'Delete')) {
              await run(() => api.deleteTasting(t.tasting_id));
            }
          }}
        />
        </View>
      )}
      <ErrorText error={error} />
    </View>
  );
}

/**
 * Fix an entry: vintage, bottles (cellar), price paid per bottle, the date,
 * notes - and the wine itself, when the scan or search picked the wrong one.
 */
function EditEntry({ t, onClose, onChanged }: { t: Tasting; onClose: () => void; onChanged: () => Promise<void> }) {
  const api = useApi();
  const { c } = useTheme();
  const cellar = t.kind === 'cellar';
  const [vintage, setVintage] = useState(t.vintage_key ?? '');
  const [bottles, setBottles] = useState(String(t.bottles ?? 1));
  const [price, setPrice] = useState(t.price_paid_cents ? String(t.price_paid_cents / 100) : '');
  const [date, setDate] = useState(t.tasted_on);
  const [notes, setNotes] = useState(t.notes ?? '');
  const [wine, setWine] = useState<{ wineId: number; name: string } | null>(null);
  const [changingWine, setChangingWine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setError(null);
    const v = vintage.trim().toUpperCase();
    if (v && !/^(1[89]\d\d|20\d\d|NV)$/.test(v)) return setError(new Error('Vintage should be a year or NV'));
    const n = Number(bottles);
    if (cellar && !(Number.isInteger(n) && n >= 1)) return setError(new Error('Bottles should be a whole number, 1 or more'));
    const p = price.trim() ? Number(price.replace(/[^0-9.]/g, '')) : null;
    if (p !== null && !(p > 0)) return setError(new Error('Price should be an amount, like 45'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError(new Error('Use a date like 2026-03-07'));
    setBusy(true);
    try {
      await api.updateTasting(t.tasting_id, {
        vintage: v || null,
        ...(cellar ? { bottles: n } : {}),
        pricePaid: p,
        tastedOn: date,
        notes,
        // With the notes, so the phone can read them together.
        tags: t.tags ?? [],
        ...(wine ? { wineId: wine.wineId } : {}),
      });
      onClose();
      await onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ gap: space[3], paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <Label>{cellar ? 'Edit this cellar entry' : 'Edit this tasting'}</Label>
      <View style={{ gap: 6 }}>
        <Muted>Wine</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text style={[type.headline, { flex: 1, color: wine ? c.accent : c.ink }]} numberOfLines={2}>{wine ? wine.name : wineTitle(t.display_name, t.sub_region)}</Text>
          <Button title={changingWine ? 'Cancel' : 'Wrong wine?'} variant="secondary" size="sm" onPress={() => setChangingWine(!changingWine)} />
        </View>
        {changingWine ? <WinePicker onPick={(w) => { setWine(w); setChangingWine(false); }} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View style={{ flex: 1 }}><Field label="Vintage" placeholder="Year or NV" autoCapitalize="characters" value={vintage} onChangeText={setVintage} maxLength={4} /></View>
        {cellar ? <View style={{ flex: 1 }}><Field label="Bottles" numeric keyboardType="number-pad" value={bottles} onChangeText={setBottles} /></View> : null}
        <View style={{ flex: 1 }}><Field label="Paid $ each" numeric keyboardType="decimal-pad" placeholder="—" value={price} onChangeText={setPrice} /></View>
      </View>
      <DateField label={cellar ? 'Added' : 'Tasted'} value={date} onChange={setDate} />
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button title="Save changes" size="sm" busy={busy} onPress={save} />
        <Button title="Cancel" variant="secondary" size="sm" onPress={onClose} />
      </View>
      <ErrorText error={error} />
    </Animated.View>
  );
}

/** Search the catalog for the right wine. */
function WinePicker({ onPick }: { onPick: (w: { wineId: number; name: string }) => void }) {
  const api = useApi();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(q.trim()).then((r) => !cancelled && setResults(r.results), () => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, q]);
  const shown = q.trim().length < 2 ? [] : results;
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row' }}><SearchBar value={q} onChangeText={setQ} autoFocus placeholder="Search for the right wine" /></View>
      {shown.slice(0, 6).map((r) => (
        <Pressable
          key={r.wineId}
          accessibilityRole="button"
          onPress={() => onPick({ wineId: r.wineId, name: r.displayName })}
          style={({ pressed }) => [{ paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: pressed ? c.fillQuiet : c.surfaceSunken }]}
        >
          <Text style={[type.subhead, { fontWeight: '600', color: c.ink }]} numberOfLines={2}>{r.displayName}</Text>
          <Muted numberOfLines={1}>{[r.region, r.country].filter(Boolean).join(' · ')}</Muted>
        </Pressable>
      ))}
    </View>
  );
}
