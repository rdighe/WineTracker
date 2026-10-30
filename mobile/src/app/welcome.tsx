/**
 * Welcome, for someone new (Home sends them here once): first, bring wines
 * over from CellarTracker or Vivino (each with how to); then a skippable 90-second taste quiz - the styles they
 * drink, a quick answer for a dozen well-known kinds of wine, what they
 * usually spend (src/recs/archetypes.ts on the server) - and their first
 * picks, with what they're based on. Ends at Home, with the tour only if they ask for it. Settings ›
 * Retake the taste quiz opens it at the quiz (?redo=1).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInRight } from 'react-native-reanimated';
import { CheckIcon } from '../components/icons';
import { CellarTrackerImport } from '../components/CellarTrackerImport';
import { VivinoImport } from '../components/VivinoImport';
import { WineThumb } from '../components/WineThumb';
import { Button, Card, Chip, ErrorText, Label, Muted, Screen, Title, radius, space, type, useTheme, wineStyleOf } from '../components/ui';
import type { WineStyle } from '../components/theme';
import { dollars, wineTitle } from '../lib/format';
import type { Archetype, Budget, Reaction, RecStyle, Recommendation } from '../lib/types';
import { useApi } from '../lib/useApi';
import { FitBadge } from '../components/FitBadge';

type Step = 'vivino' | 'styles' | 'react' | 'budget' | 'picks';
const QUIZ: Step[] = ['styles', 'react', 'budget'];
/** Kinds of wine asked about: enough to place a palate, few enough for 90 seconds. */
const MAX_ASKED = 10;

const STYLES: { key: RecStyle; label: string; wash: WineStyle }[] = [
  { key: 'red', label: 'Red', wash: 'red' }, { key: 'white', label: 'White', wash: 'white' }, { key: 'rose', label: 'Rosé', wash: 'rose' },
  { key: 'sparkling', label: 'Sparkling', wash: 'sparkling' }, { key: 'sweet', label: 'Dessert & port', wash: 'fortified' },
];
const WASH: Record<RecStyle, WineStyle> = { red: 'red', white: 'white', rose: 'rose', sparkling: 'sparkling', orange: 'orange', sweet: 'fortified' };
const BUDGETS: { key: Budget; label: string }[] = [
  { key: 'under20', label: 'Under $20' }, { key: '20to40', label: '$20–40' }, { key: '40to80', label: '$40–80' }, { key: 'over80', label: '$80 and up' },
];
const REACTIONS: { key: Reaction; label: string }[] = [
  { key: 'love', label: 'Love it' }, { key: 'fine', label: "It's fine" }, { key: 'dislike', label: 'Not for me' }, { key: 'unknown', label: 'Never had it' },
];

export default function Welcome() {
  const api = useApi();
  const { c } = useTheme();
  const { redo } = useLocalSearchParams<{ redo?: string }>();
  const [step, setStep] = useState<Step>(redo ? 'styles' : 'vivino');
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [styles, setStyles] = useState<RecStyle[]>([]);
  const [seeds, setSeeds] = useState<Partial<Record<string, Reaction>>>({});
  const [budget, setBudget] = useState<Budget | null>(null);
  const [asked, setAsked] = useState(0);
  const [imported, setImported] = useState(false);
  const [from, setFrom] = useState<'cellartracker' | 'vivino' | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.onboarding().then((o) => {
      setArchetypes(o.archetypes);
      setStyles(o.styles);
      setSeeds(o.seeds);
      setBudget(o.budget);
    }, setError);
  }, [api]);

  // The kinds of wine to ask about: those in the styles they drink first, a few of each in turn.
  const queue = useMemo(() => {
    const wanted = styles.length ? styles : STYLES.map((s) => s.key);
    const first = archetypes.filter((a) => wanted.includes(a.style));
    const rest = archetypes.filter((a) => !wanted.includes(a.style));
    return [...first, ...rest].slice(0, MAX_ASKED);
  }, [archetypes, styles]);

  /** Leave for Home and its tour; answers so far are kept. */
  async function finish(skipped: boolean) {
    await api.saveOnboarding({ styles, budget, seeds, done: true, skipped }).catch(() => {});
    router.dismissTo('/');
  }

  const quizAt = QUIZ.indexOf(step);
  const progress = step === 'react' ? (1 + asked / Math.max(1, queue.length)) / QUIZ.length : quizAt >= 0 ? quizAt / QUIZ.length : step === 'picks' ? 1 : 0;

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        {step !== 'vivino' && step !== 'picks' ? (
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.fillQuiet, marginRight: space[4], overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: 6, backgroundColor: c.accent }} />
          </View>
        ) : <View />}
        {step !== 'picks' ? <Button title="Skip" variant="plain" size="sm" onPress={() => void finish(true)} /> : null}
      </View>
      <ErrorText error={error} />

      {step === 'vivino' ? (
        <Animated.View entering={FadeIn.duration(250)} style={{ gap: space[5] }}>
          <View style={{ gap: space[2] }}>
            <Title>Welcome to WineTracker</Title>
            <Text style={[type.body, { color: c.ink2 }]}>Start with what you already know. Bring your cellar and ratings over and your first picks are built on them.</Text>
          </View>
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: space[2] }}>
            <Chip selected={from === 'cellartracker'} onPress={() => setFrom(from === 'cellartracker' ? null : 'cellartracker')}>From CellarTracker</Chip>
            <Chip selected={from === 'vivino'} onPress={() => setFrom(from === 'vivino' ? null : 'vivino')}>From Vivino</Chip>
          </View>
          {from === 'cellartracker' ? (
            <Card style={{ gap: space[3] }}>
              <Text style={[type.headline, { color: c.ink }]}>Import from CellarTracker</Text>
              <CellarTrackerImport bare onDone={() => setImported(true)} />
            </Card>
          ) : from === 'vivino' ? (
            <Card style={{ gap: space[3] }}>
              <Text style={[type.headline, { color: c.ink }]}>Import from Vivino</Text>
              <VivinoImport bare onDone={() => setImported(true)} />
            </Card>
          ) : (
            <Muted>Pick where your wines are now. Both can be done later from Settings.</Muted>
          )}
          {imported ? (
            <Button title="Next" onPress={() => setStep('styles')} />
          ) : (
            <View style={{ gap: space[2] }}>
              <Button title={from ? 'Skip this for now' : "I don't use either"} variant="secondary" onPress={() => setStep('styles')} />
              <Muted style={{ textAlign: 'center' }}>Next: a 90-second taste quiz you can skip.</Muted>
            </View>
          )}
        </Animated.View>
      ) : null}

      {step === 'styles' ? (
        <Animated.View entering={FadeInRight.duration(250)} style={{ gap: space[5] }}>
          <View style={{ gap: space[2] }}>
            <Title>What do you usually drink?</Title>
            <Muted>{imported ? 'Your wines are in. A few answers will sharpen your picks.' : 'Pick any. About 90 seconds in all.'}</Muted>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {STYLES.map((s) => (
              <Chip key={s.key} dot={s.wash} selected={styles.includes(s.key)} onPress={() => setStyles(styles.includes(s.key) ? styles.filter((x) => x !== s.key) : [...styles, s.key])}>{s.label}</Chip>
            ))}
          </View>
          <Button title="Next" onPress={() => { setAsked(0); setStep('react'); }} />
        </Animated.View>
      ) : null}

      {step === 'react' && queue[asked] ? (
        <ReactionCard
          key={queue[asked]!.key}
          a={queue[asked]!}
          n={asked + 1}
          of={queue.length}
          current={seeds[queue[asked]!.key]}
          onAnswer={(r) => {
            setSeeds({ ...seeds, [queue[asked]!.key]: r });
            if (asked + 1 >= queue.length) setStep('budget');
            else setAsked(asked + 1);
          }}
          onBack={() => (asked ? setAsked(asked - 1) : setStep('styles'))}
        />
      ) : null}

      {step === 'budget' ? (
        <Animated.View entering={FadeInRight.duration(250)} style={{ gap: space[5] }}>
          <View style={{ gap: space[2] }}>
            <Title>What do you usually spend on a bottle?</Title>
            <Muted>For a regular night in. Picks start around here and move as you rate.</Muted>
          </View>
          <View style={{ gap: space[2] }}>
            {BUDGETS.map((b) => (
              <Button key={b.key} title={b.label} variant={budget === b.key ? 'primary' : 'secondary'} onPress={() => setBudget(b.key)}
                icon={budget === b.key ? (fg) => <CheckIcon color={fg} size={16} /> : undefined} />
            ))}
          </View>
          <Button title="See my first picks" variant="tinted" onPress={async () => {
            await api.saveOnboarding({ styles, budget, seeds, done: true, skipped: false }).catch(setError);
            setStep('picks');
          }} />
        </Animated.View>
      ) : null}

      {step === 'picks' ? <FirstPicks onDone={(tour) => router.dismissTo(tour ? '/?tour=1' : '/')} /> : null}
    </Screen>
  );
}

function ReactionCard({ a, n, of, current, onAnswer, onBack }: {
  a: Archetype; n: number; of: number; current?: Reaction; onAnswer: (r: Reaction) => void; onBack: () => void;
}) {
  const { c } = useTheme();
  return (
    <Animated.View entering={FadeInRight.duration(220)} style={{ gap: space[5] }}>
      <Label>{`${n} of ${of}`}</Label>
      <View style={{ borderRadius: radius.lg, backgroundColor: c.wash[WASH[a.style]], padding: space[5], gap: space[3], minHeight: 220, justifyContent: 'flex-end' }}>
        <WineThumb uri={null} wineStyle={WASH[a.style]} width={48} height={66} />
        <Text accessibilityRole="header" style={[type.wineDisplay, { color: c.ink }]}>{a.title}</Text>
        <Text style={[type.body, { color: c.ink2 }]}>{a.detail}</Text>
      </View>
      <View style={{ gap: space[2] }}>
        {REACTIONS.map((r) => (
          <Button key={r.key} title={r.label} variant={current === r.key ? 'primary' : r.key === 'unknown' ? 'plain' : 'secondary'} onPress={() => onAnswer(r.key)} />
        ))}
      </View>
      <Button title="Back" variant="plain" size="sm" onPress={onBack} />
    </Animated.View>
  );
}

/** The first picks the answers give, and why. */
function FirstPicks({ onDone }: { onDone: (tour: boolean) => void }) {
  const api = useApi();
  const { c } = useTheme();
  const [items, setItems] = useState<Recommendation[] | null>(null);
  useEffect(() => {
    api.recommendations().then((r) => setItems(r.mode === 'profile' ? r.items.slice(0, 3) : []), () => setItems([]));
  }, [api]);
  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Title>Your first picks</Title>
        <Muted>From what you told us. Rate what you drink and they get sharper; Discover has more.</Muted>
      </View>
      {!items ? <ActivityIndicator color={c.ink3} /> : items.length ? items.map((r) => (
        <Card key={r.wineId} style={{ flexDirection: 'row', gap: space[3], backgroundColor: c.wash[wineStyleOf(r.colour, r.wineType)] }}>
          <WineThumb uri={r.imageUrl} wineStyle={wineStyleOf(r.colour, r.wineType)} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{wineTitle(r.displayName, r.region)}</Text>
            <FitBadge fit={r.fit} />
            {r.reasons.slice(0, 2).map((x) => <Text key={x} style={[type.footnote, { color: c.ink2 }]}>{x}</Text>)}
            {r.medianCents ? <Text style={[type.figure, { color: c.ink }]}>{dollars(r.medianCents)}</Text> : null}
          </View>
        </Card>
      )) : <Muted>Picks will show up as soon as there are prices for wines like these.</Muted>}
      <Button title="Start" onPress={() => onDone(false)} />
      <Button title="Show me around first" variant="secondary" onPress={() => onDone(true)} />
    </Animated.View>
  );
}
