/**
 * Find a bottle (Home): what you're after - the occasion, what's on the
 * table, a style - and where to look: your cellar (GET /api/cellar/picks),
 * shops near you, and all wines (GET /api/recommendations with the same food
 * and styles, near you or anywhere). First, the kind of wine that best suits
 * the occasion (GET /api/occasion/kinds); then your own bottles, then the
 * rest. ?occasion= starts it from one of Home's quick answers.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BackIcon, CheckIcon, PinIcon, StoreIcon } from '../components/icons';
import { nearbyLabel } from '../components/NearBar';
import { WineThumb } from '../components/WineThumb';
import { Button, Card, Chip, ErrorText, Field, IconButton, Label, Muted, Screen, Title, space, type, useTheme, wineStyleOf } from '../components/ui';
import type { WineStyle } from '../components/theme';
import { dollars, partOfDay, wineTitle } from '../lib/format';
import { useLocation } from '../lib/location';
import type { BestKind, CellarPick, RecStyle, Recommendation } from '../lib/types';
import { useApi } from '../lib/useApi';
import { FitBadge } from '../components/FitBadge';

type Occasion = 'dinner' | 'guests' | 'celebrate' | 'new';
const OCCASIONS: { key: Occasion; label: string }[] = [
  { key: 'dinner', label: partOfDay() === 'tonight' ? 'With dinner' : 'With lunch' },
  { key: 'guests', label: 'Having people over' },
  { key: 'celebrate', label: 'Celebrating' },
  { key: 'new', label: 'Something new' },
];
const STYLES: { key: RecStyle; label: string; dot: WineStyle }[] = [
  { key: 'red', label: 'Red', dot: 'red' },
  { key: 'white', label: 'White', dot: 'white' },
  { key: 'rose', label: 'Rosé', dot: 'rose' },
  { key: 'sparkling', label: 'Sparkling', dot: 'sparkling' },
  { key: 'sweet', label: 'Dessert', dot: 'fortified' },
];
const STYLE_DOT: Record<string, WineStyle> = { red: 'red', white: 'white', rose: 'rose', sparkling: 'sparkling', orange: 'orange', sweet: 'fortified' };

interface Asked { occasion: Occasion | null; food: string; styles: RecStyle[]; cellar: boolean; near: boolean; all: boolean }
interface Answer { kinds: BestKind[]; cellar: CellarPick[] | null; near: Recommendation[] | null; nearApplied: boolean; all: Recommendation[] | null }

export default function FindABottle() {
  const api = useApi();
  const { c } = useTheme();
  const loc = useLocation();
  const params = useLocalSearchParams<{ occasion?: string }>();
  const start = OCCASIONS.find((o) => o.key === params.occasion)?.key ?? null;
  const [asked, setAsked] = useState<Asked>({
    occasion: start,
    food: '',
    // A celebration starts with sparkling; you can change it.
    styles: start === 'celebrate' ? ['sparkling'] : [],
    // Something new looks in shops, not the cellar you already know.
    cellar: start !== 'new',
    near: Boolean(loc.near),
    // Without a location, the best wines anywhere.
    all: !loc.near,
  });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const run = useCallback(async (a: Asked) => {
    const mine = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const search = { food: a.food, styles: a.styles };
      const [kinds, cellar, near, all] = await Promise.all([
        api.occasionKinds({ occasion: a.occasion, ...search }).then((r) => r.kinds, () => []),
        a.cellar ? api.cellarPicks(search).then((r) => r.items.slice(0, 3)) : Promise.resolve(null),
        a.near && loc.near ? api.recommendations({ ...search, near: loc.near }) : Promise.resolve(null),
        a.all ? api.recommendations(search) : Promise.resolve(null),
      ]);
      if (mine !== latest.current) return;
      const nearItems = near?.mode === 'profile' ? near.items.slice(0, cellar && cellar.length >= 3 ? 2 : 4) : near ? [] : null;
      // All wines: those not already shown as near you.
      const shown = new Set((nearItems ?? []).map((r) => r.wineId));
      setAnswer({
        kinds,
        cellar,
        near: nearItems,
        nearApplied: near?.mode === 'profile' ? near.near?.applied !== false : false,
        all: all?.mode === 'profile' ? all.items.filter((r) => !shown.has(r.wineId)).slice(0, 4) : all ? [] : null,
      });
    } catch (e) {
      if (mine === latest.current) setError(e);
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, [api, loc.near]);

  // Opened from a quick answer: show bottles straight away; the form stays above to refine.
  useEffect(() => {
    if (!start) return;
    const t = setTimeout(() => void run(asked), 0);
    return () => clearTimeout(t);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (p: Partial<Asked>) => setAsked((a) => ({ ...a, ...p }));
  const toggleStyle = (s: RecStyle) => set({ styles: asked.styles.includes(s) ? asked.styles.filter((x) => x !== s) : [...asked.styles, s] });

  return (
    <Screen tabBar={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -space[2] }}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
      </View>
      <Title>Find a bottle</Title>

      <View style={{ gap: space[2] }}>
        <Label>{'What’s the occasion?'}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {OCCASIONS.map((o) => (
            <Chip key={o.key} selected={asked.occasion === o.key} onPress={() => set({ occasion: asked.occasion === o.key ? null : o.key, ...(o.key === 'new' ? { cellar: false, near: Boolean(loc.near) } : {}) })}>{o.label}</Chip>
          ))}
        </View>
      </View>
      <Field label="What's on the table?" value={asked.food} onChangeText={(food) => set({ food })} placeholder="Lamb chops, sushi, a cheese board…" returnKeyType="search" onSubmitEditing={() => void run(asked)} />
      <View style={{ gap: space[2] }}>
        <Label>Any style? (optional)</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {STYLES.map((s) => <Chip key={s.key} dot={s.dot} selected={asked.styles.includes(s.key)} onPress={() => toggleStyle(s.key)}>{s.label}</Chip>)}
        </View>
      </View>
      <View style={{ gap: space[2] }}>
        <Label>Look in</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <Chip selected={asked.cellar} onPress={() => set({ cellar: !asked.cellar })}>My cellar</Chip>
          <Chip selected={asked.near} onPress={() => (loc.near ? set({ near: !asked.near }) : router.push('/settings'))}>
            {loc.here ? `Shops near ${loc.here.label}` : 'Shops near me (turn on Location)'}
          </Chip>
          <Chip selected={asked.all} onPress={() => set({ all: !asked.all })}>All wines</Chip>
        </View>
      </View>
      <Button title="Show me bottles" busy={busy} disabled={!asked.cellar && !(asked.near && loc.near) && !asked.all} onPress={() => void run(asked)} />
      <ErrorText error={error} />

      {answer ? (
        <View style={{ gap: space[5] }}>
          {answer.kinds[0] ? <KindCard kind={answer.kinds[0]} also={answer.kinds[1]} /> : null}
          {answer.cellar ? (
            <View style={{ gap: space[3] }}>
              <Text accessibilityRole="header" style={[type.title3, { color: c.ink }]}>From your cellar</Text>
              {answer.cellar.length ? answer.cellar.map((p, i) => (
                <Animated.View key={p.wineId} entering={FadeInDown.delay(i * 60).duration(260)}>
                  <CellarCard p={p} />
                </Animated.View>
              )) : <Muted style={type.subhead}>{asked.styles.length ? 'Nothing in your cellar in that style.' : 'No bottles in your cellar yet. Add some with + and “In my cellar”.'}</Muted>}
            </View>
          ) : null}
          {answer.near ? (
            <View style={{ gap: space[3] }}>
              <View>
                <Text accessibilityRole="header" style={[type.title3, { color: c.ink }]}>Near you</Text>
                {!answer.nearApplied && answer.near.length ? <Muted style={type.footnote}>No shop near you has these yet; showing the best anywhere.</Muted> : null}
              </View>
              {answer.near.length ? answer.near.map((r, i) => (
                <Animated.View key={r.wineId} entering={FadeInDown.delay(i * 60).duration(260)}>
                  <ShopCard r={r} />
                </Animated.View>
              )) : <Muted style={type.subhead}>Rate a few wines to get suggestions from shops.</Muted>}
            </View>
          ) : null}
          {answer.all ? (
            <View style={{ gap: space[3] }}>
              <Text accessibilityRole="header" style={[type.title3, { color: c.ink }]}>Best for this, anywhere</Text>
              {answer.all.length ? answer.all.map((r, i) => (
                <Animated.View key={r.wineId} entering={FadeInDown.delay(i * 60).duration(260)}>
                  <ShopCard r={r} anywhere />
                </Animated.View>
              )) : <Muted style={type.subhead}>Rate a few wines and the best ones for the occasion show here.</Muted>}
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

/** A bottle you own: on its wash, why it fits, how many, and where it is. */
function CellarCard({ p }: { p: CellarPick }) {
  const { c } = useTheme();
  const ws = STYLE_DOT[p.style] ?? 'red';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${wineTitle(p.displayName)}, ${p.bottles} in your cellar. ${p.reasons[0] ?? ''}`} onPress={() => router.push(`/wine/${p.wineId}`)} style={({ pressed }) => pressed && { opacity: 0.9 }}>
      <Card style={{ backgroundColor: c.wash[ws], gap: space[3] }}>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <WineThumb uri={p.imageUrl} wineStyle={ws} width={56} height={74} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.caption, { color: c.ink2, letterSpacing: 0.6 }]}>FROM YOUR CELLAR</Text>
            <Text style={[type.wineTitle, { fontSize: 19, lineHeight: 24, color: c.ink }]} numberOfLines={2}>{wineTitle(p.displayName)}</Text>
            <Text style={[type.footnote, { color: c.ink2 }]} numberOfLines={1}>{[p.region, p.vintages.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
        <FitBadge fit={p.fit} />
        <Reasons reasons={p.reasons} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <PinIcon color={c.ink} size={16} />
          <Text style={[type.subhead, { flex: 1, fontWeight: '600', color: c.ink }]} numberOfLines={2}>{[`${p.bottles} ${p.bottles === 1 ? 'bottle' : 'bottles'}`, p.cellar, p.place ?? p.location].filter(Boolean).join(' · ')}</Text>
          {p.medianCents ? <Text style={[type.figure, { fontSize: 15, color: c.ink2 }]}>{dollars(p.medianCents)}</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}

/** A wine to buy: on its wash, why it fits, the nearest shop, and the price. */
function ShopCard({ r, anywhere }: { r: Recommendation; anywhere?: boolean }) {
  const { c } = useTheme();
  const ws = wineStyleOf(r.colour, r.wineType);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${wineTitle(r.displayName)}, ${dollars(r.medianCents)}. ${r.reasons[0] ?? ''}`} onPress={() => router.push(`/wine/${r.wineId}`)} style={({ pressed }) => pressed && { opacity: 0.9 }}>
      <Card style={{ backgroundColor: c.wash[ws], gap: space[3] }}>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <WineThumb uri={r.imageUrl} wineStyle={ws} width={56} height={74} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.caption, { color: c.ink2, letterSpacing: 0.6 }]}>{anywhere ? 'TO BUY' : 'NEAR YOU'}</Text>
            <Text style={[type.wineTitle, { fontSize: 19, lineHeight: 24, color: c.ink }]} numberOfLines={2}>{wineTitle(r.displayName)}</Text>
            <Text style={[type.footnote, { color: c.ink2 }]} numberOfLines={1}>{r.region}</Text>
          </View>
          <Text style={[type.figure, { color: c.ink }]}>{dollars(r.medianCents)}</Text>
        </View>
        <FitBadge fit={r.fit} />
        <Reasons reasons={r.reasons} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <StoreIcon color={c.ink} size={16} />
          <Text style={[type.subhead, { flex: 1, fontWeight: '600', color: c.ink }]} numberOfLines={1}>{r.nearby ? nearbyLabel(r.nearby) : `${r.nMerchants} ${r.nMerchants === 1 ? 'shop' : 'shops'}`}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function Reasons({ reasons }: { reasons: string[] }) {
  const { c } = useTheme();
  if (!reasons.length) return null;
  return (
    <View style={{ gap: 4 }}>
      {reasons.map((r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <View style={{ marginTop: 3 }}><CheckIcon color={c.positive} /></View>
          <Text style={[type.subhead, { flex: 1, color: c.ink }]}>{r}</Text>
        </View>
      ))}
    </View>
  );
}


/** The kind of wine that suits the occasion best (an example, not a bottle), why, and the runner-up. */
function KindCard({ kind, also }: { kind: BestKind; also?: BestKind }) {
  const { c } = useTheme();
  const ws = STYLE_DOT[kind.style] ?? 'red';
  return (
    <Animated.View entering={FadeInDown.duration(260)}>
      <Card style={{ backgroundColor: c.wash[ws], gap: space[3], borderWidth: 1.5, borderColor: c.accent }}>
        <Text style={[type.caption, { color: c.accent, letterSpacing: 0.6 }]}>BEST KIND OF WINE FOR THIS</Text>
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" style={[type.wineDisplay, { color: c.ink }]}>{kind.title}</Text>
          <Text style={[type.subhead, { color: c.ink2 }]}>{kind.detail}</Text>
        </View>
        <FitBadge fit={kind.fit} />
        <Reasons reasons={kind.reasons} />
        {also ? <Muted>{`Also good: ${also.title}`}</Muted> : null}
      </Card>
    </Animated.View>
  );
}
