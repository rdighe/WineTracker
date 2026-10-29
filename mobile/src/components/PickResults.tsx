/**
 * A wine list or store shelf ranked for the person's palate (POST
 * /api/picks): the top picks, the rest, and how each price compares with
 * typical retail. Used for a new scan and for a saved list (app/picks.tsx).
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { dollars, wineTitle } from '../lib/format';
import type { PickItem, PickResult } from '../lib/types';
import { useApi } from '../lib/useApi';
import { BackIcon, CheckIcon } from './icons';
import { wineStyleOf } from './theme';
import { Card, Chip, Divider, ErrorText, Field, Heading, IconButton, Muted, Screen, Segmented, Title, size, space, type, useTheme } from './ui';
import { WineThumb } from './WineThumb';

export type Kind = 'list' | 'shelf';
type Serving = 'glass' | 'bottle';
type Range = { key: string; label: string; min: number | null; max: number | null };

/** Price ranges by serving (and for a store shelf), in dollars. */
const RANGES: Record<Serving | 'shelf', Range[]> = {
  glass: [
    { key: 'any', label: 'Any', min: null, max: null },
    { key: 'lo', label: 'Under $15', min: null, max: 15 },
    { key: 'mid', label: '$15–25', min: 15, max: 25 },
    { key: 'hi', label: '$25+', min: 25, max: null },
  ],
  bottle: [
    { key: 'any', label: 'Any', min: null, max: null },
    { key: 'lo', label: 'Under $60', min: null, max: 60 },
    { key: 'mid', label: '$60–120', min: 60, max: 120 },
    { key: 'hi', label: '$120+', min: 120, max: null },
  ],
  shelf: [
    { key: 'any', label: 'Any', min: null, max: null },
    { key: 'lo', label: 'Under $20', min: null, max: 20 },
    { key: 'mid', label: '$20–40', min: 20, max: 40 },
    { key: 'hi', label: '$40+', min: 40, max: null },
  ],
};
const TOP = 3;

const priceFor = (i: PickItem, s: Serving) => (s === 'glass' ? i.entry.glassCents : i.entry.bottleCents);

/**
 * A list or shelf ranked for the person: the top picks, then the rest, with
 * a glass/bottle switch and price ranges that filter on the phone.
 * `header` goes above (photos, a saved list's name); `footer` below (save, add a page, delete).
 */
export function PickResults({ kind, result, title: heading, onBack, header, footer, error }: {
  kind: Kind; result: PickResult; title?: string; onBack: () => void; header?: ReactNode; footer?: ReactNode; error?: unknown;
}) {
  const api = useApi();
  const { c } = useTheme();
  /** Tapping a wine: have it, or open it. */
  const choose = (item: PickItem) => {
    const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: kind === 'shelf' ? "I'm buying this" : "I'm having this", onPress: () => void haveIt(api, kind, item, serving) }];
    if (item.wineId) buttons.push({ text: 'See the wine', onPress: () => router.push(`/wine/${item.wineId}`) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(title(item), undefined, buttons);
  };
  const glasses = result.items.filter((i) => i.entry.glassCents).length;
  const bottles = result.items.filter((i) => i.entry.bottleCents).length;
  const [serving, setServing] = useState<Serving>(glasses > bottles ? 'glass' : 'bottle');
  const [rangeKey, setRangeKey] = useState('any');
  const [custom, setCustom] = useState({ min: '', max: '' });
  const ranges = RANGES[kind === 'shelf' ? 'shelf' : serving];
  const range = rangeKey === 'custom'
    ? { min: Number(custom.min) || null, max: Number(custom.max) || null }
    : ranges.find((r) => r.key === rangeKey) ?? ranges[0]!;

  const shown = result.items.filter((i) => {
    const p = priceFor(i, serving);
    if (p === null) return false;
    return (range.min === null || p >= range.min * 100) && (range.max === null || p <= range.max * 100);
  });
  const top = shown.slice(0, TOP);
  const rest = shown.slice(TOP);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton label="Back" onPress={onBack}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
        <Text style={[type.footnote, { color: c.ink2 }]}>{`${result.items.length} wine${result.items.length === 1 ? '' : 's'}`}</Text>
        <View style={{ width: size.tapMin }} />
      </View>
      {header}
      <View>
        {heading ? <Muted>{heading}</Muted> : null}
        <Title>{result.mode === 'profile' ? 'Best for you' : 'Best value'}</Title>
      </View>
      {result.mode === 'locked' ? (
        <Muted>{`Rate ${Math.max(1, 3 - result.rated)} more wine${3 - result.rated === 1 ? '' : 's'} to rank these for your palate. Until then, ${kind === 'shelf' ? 'the best deals' : 'the lowest markups'} come first.`}</Muted>
      ) : null}

      {kind === 'list' && glasses && bottles ? (
        <Segmented<Serving>
          options={[{ key: 'glass', label: `By the glass (${glasses})` }, { key: 'bottle', label: `Bottles (${bottles})` }]}
          value={serving}
          onChange={(s) => { setServing(s); if (rangeKey !== 'custom') setRangeKey('any'); }}
        />
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {ranges.map((r) => (
          <Chip key={r.key} small selected={rangeKey === r.key} onPress={() => setRangeKey(r.key)}>{r.label}</Chip>
        ))}
        <Chip small selected={rangeKey === 'custom'} onPress={() => setRangeKey('custom')}>Custom</Chip>
      </View>
      {rangeKey === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <Field label="Min $" numeric value={custom.min} onChangeText={(min) => setCustom({ ...custom, min })} style={{ flex: 1 }} />
          <Field label="Max $" numeric value={custom.max} onChangeText={(max) => setCustom({ ...custom, max })} style={{ flex: 1 }} />
        </View>
      ) : null}

      {!shown.length ? <Muted>{result.items.length ? 'Nothing in that range.' : `No wines found. Try another photo${kind === 'shelf' ? ', with the price tags in it' : ''}.`}</Muted> : null}
      {top.map((i, n) => <TopCard key={i.index} kind={kind} item={i} rank={n + 1} serving={serving} onPress={() => choose(i)} />)}
      {rest.length ? (
        <View style={{ gap: space[2] }}>
          <Heading>{kind === 'shelf' ? 'The rest of the shelf' : 'The rest of the list'}</Heading>
          <Card flush>
            {rest.map((i, n) => (
              <View key={i.index}>
                {n ? <Divider style={{ marginLeft: space[4] }} /> : null}
                <Row kind={kind} item={i} serving={serving} onPress={() => choose(i)} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      <ErrorText error={error} />
      {footer}
    </Screen>
  );
}

/**
 * The price against typical US retail. On a list, the markup: low is good
 * value, 2-3x is usual for restaurants. On a shelf, whether it's a good deal.
 */
function MarkupBadge({ kind, item, serving }: { kind: Kind; item: PickItem; serving: Serving }) {
  const { c } = useTheme();
  const m = serving === 'glass' ? item.glassMarkup : item.markup;
  if (m === null || !item.retailCents) return null;
  if (kind === 'shelf') {
    const diff = Math.abs((item.entry.bottleCents ?? 0) * 750 / (item.entry.bottleMl ?? 750) - item.retailCents);
    const [label, color] = m < 0.92 ? [`Good deal · ${dollars(diff)} below typical`, c.positive] : m <= 1.1 ? ['About the typical price', c.ink2] : [`${dollars(diff)} above typical`, c.caution];
    return <Text style={[type.footnote, { color }]}>{`${label} (${dollars(item.retailCents)})`}</Text>;
  }
  const [label, color] = m <= 2 ? ['Good value', c.positive] : m <= 3 ? ['Usual markup', c.ink2] : ['High markup', c.caution];
  return (
    <Text style={[type.footnote, { color }]}>
      {`${label} · ${m.toFixed(1)}× retail (${dollars(item.retailCents)}${serving === 'glass' ? ' a bottle' : ''})`}
    </Text>
  );
}

const title = (i: PickItem) => [wineTitle(i.displayName, i.match === 'guess' ? null : i.region), i.entry.vintage].filter(Boolean).join(' ');

function TopCard({ kind, item, rank, serving, onPress }: { kind: Kind; item: PickItem; rank: number; serving: Serving; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <WineThumb uri={item.imageUrl} wineStyle={wineStyleOf(item.style || item.entry.colour, item.entry.style)} width={56} height={72} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.caption, { color: c.onAccent }]}>{rank}</Text>
              </View>
            </View>
            <Text style={[type.wineTitle, { color: c.ink }]}>{title(item)}</Text>
            {item.region ? <Muted style={type.subhead}>{item.region}</Muted> : null}
          </View>
          <Text style={[type.figure, { color: c.ink }]}>{dollars(priceFor(item, serving))}</Text>
        </View>
        {item.reasons.length ? (
          <View style={{ gap: 2 }}>
            {item.reasons.map((r) => (
              <View key={r} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <CheckIcon color={c.positive} />
                <Text style={[type.subhead, { color: c.ink2, flex: 1 }]}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <MarkupBadge kind={kind} item={item} serving={serving} />
      </Card>
    </Pressable>
  );
}

function Row({ kind, item, serving, onPress }: { kind: Kind; item: PickItem; serving: Serving; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.row, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: c.ink }]} numberOfLines={2}>{title(item)}</Text>
        {item.myRating !== null ? <Muted style={type.footnote}>{`You rated it ${item.myRating}`}</Muted> : null}
        <MarkupBadge kind={kind} item={item} serving={serving} />
      </View>
      <Text style={[type.figure, { color: c.ink }]}>{dollars(priceFor(item, serving))}</Text>
    </Pressable>
  );
}

/**
 * "I'm having this" (a restaurant tasting at the list price) or "I'm buying
 * this" (a cellar bottle at the shelf price); a new wine if it isn't in the
 * catalog. Then the wine's page.
 */
async function haveIt(api: ReturnType<typeof useApi>, kind: Kind, item: PickItem, serving: Serving) {
  try {
    const wineId = item.wineId ?? (await api.createWine({ producer: item.entry.producer, name: item.entry.name || item.entry.text, region: item.entry.region })).wine_id;
    const price = priceFor(item, serving);
    await api.addTasting({
      wineId,
      vintage: item.entry.vintage || null,
      pricePaid: price ? price / 100 : null,
      priceContext: kind === 'shelf' ? 'retail' : 'restaurant',
      bottleMl: serving === 'glass' ? 150 : item.entry.bottleMl ?? 750,
      ...(kind === 'shelf' ? { kind: 'cellar' as const, bottles: 1 } : { kind: 'tasted' as const, setting: 'restaurant' as const }),
    });
    router.push(`/wine/${wineId}`);
  } catch (e) {
    Alert.alert("Couldn't save it", e instanceof Error ? e.message : String(e));
  }
}
