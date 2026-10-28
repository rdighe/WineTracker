/**
 * A wine's cellar entries and tastings, each editable in place: bottles up
 * and down, dates changed, ratings changed, entries removed. Shown on My wines
 * and on the wine's own page.
 */
import { useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dollars, shortDate } from '../lib/format';
import type { Tasting } from '../lib/types';
import { useApi } from '../lib/useApi';
import { DateField } from './DateField';
import { Button, ErrorText, Label, Muted, PriceDelta, Rating, radius, space, type, useTheme } from './ui';

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
  return (
    <View style={{ gap: 6, paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1, flexWrap: 'wrap' }}>
          <Text style={[type.headline, type.tabular, { color: c.ink }]}>{t.vintage_key ?? 'NV'}</Text>
          <Badge>{`${n} ${n === 1 ? 'bottle' : 'bottles'}`}</Badge>
          {t.paid_750_cents ? <Muted style={type.tabular}>paid {dollars(t.price_paid_cents)}</Muted> : null}
          <PriceDelta paid={t.paid_750_cents} now={t.market_now_cents} percentOnly />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <Button title="−" variant="secondary" size="sm" accessibilityLabel="One bottle fewer" onPress={() => run(() => (n > 1 ? api.updateTasting(t.tasting_id, { bottles: n - 1 }) : Promise.resolve()))} />
          <Button title="+" variant="secondary" size="sm" accessibilityLabel="One bottle more" onPress={() => run(() => api.updateTasting(t.tasting_id, { bottles: n + 1 }))} />
        </View>
      </View>
      <DateEdit t={t} onChanged={onChanged} label="Added" />
      {t.rating != null || t.notes ? <Muted>{[t.rating != null ? `Rated ${t.rating}` : '', t.notes].filter(Boolean).join(' · ')}</Muted> : null}
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
      )}
      <ErrorText error={error} />
    </View>
  );
}
