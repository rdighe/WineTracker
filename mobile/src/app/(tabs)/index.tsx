/**
 * Home: where the app opens. The name, one question for right now ("What would
 * you like to drink today?", "tonight" from 5 pm), the way in to wine-list and
 * shelf picks for when you're out, what's in your cellar, what's worth buying
 * near you, and your saved lists. The tour (components/Tour.tsx) runs here the
 * first time, and again from Settings › Show the tour (?tour=1).
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lift } from '../../components/Glass';
import { ChevronIcon, DocumentIcon, ListIcon, ShelfIcon, SparkleIcon } from '../../components/icons';
import { nearbyLabel } from '../../components/NearBar';
import { ProfileButton } from '../../components/ProfileButton';
import { Tour, useTourTarget } from '../../components/Tour';
import { WinePhoto, WineThumb } from '../../components/WineThumb';
import { Button, Card, Chip, Divider, Muted, radius, size, space, type, useTheme, wineStyleOf } from '../../components/ui';
import { dollars, partOfDay, shortDate, wineTitle } from '../../lib/format';
import { useLocation } from '../../lib/location';
import { tour } from '../../lib/tour';
import { afterIntro } from '../../lib/intro';
import type { Recommendation, SavedPick, Tasting, CommunityNote } from '../../lib/types';
import { usePullRefresh } from '../../lib/usePullRefresh';
import { useApi } from '../../lib/useApi';
import { FitBadge, fitWords } from '../../components/FitBadge';
import { NoteCard } from '../../components/NoteCard';

/** The quick answers under the question; each opens Find a bottle already started that way. */
const OCCASIONS = [
  { key: 'dinner', label: { today: 'With lunch', tonight: 'With dinner' } },
  { key: 'guests', label: { today: 'Having people over', tonight: 'Having people over' } },
  { key: 'celebrate', label: { today: 'Celebrating', tonight: 'Celebrating' } },
  { key: 'new', label: { today: 'Something new', tonight: 'Something new' } },
] as const;

interface Held { wineId: number; wine: Tasting; bottles: number; vintages: string[] }

/** Cellar entries, one per wine, most recently added first. */
function held(rows: Tasting[]): Held[] {
  const by = new Map<number, Held>();
  for (const t of rows) {
    if (t.kind !== 'cellar') continue;
    const h = by.get(t.wine_id) ?? { wineId: t.wine_id, wine: t, bottles: 0, vintages: [] };
    h.bottles += t.bottles ?? 1;
    const v = t.vintage_key || 'NV';
    if (!h.vintages.includes(v)) h.vintages.push(v);
    by.set(t.wine_id, h);
  }
  return [...by.values()];
}

export default function Home() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const loc = useLocation();
  const params = useLocalSearchParams<{ tour?: string }>();
  const scroll = useRef<ScrollView>(null);
  const when = partOfDay();
  const [cellar, setCellar] = useState<Held[] | null>(null);
  const [near, setNear] = useState<Recommendation[] | null>(null);
  const [lists, setLists] = useState<SavedPick[] | null>(null);
  const [notes, setNotes] = useState<CommunityNote[] | null>(null);
  const [touring, setTouring] = useState(false);
  const promptTarget = useTourTarget('prompt');
  const scanTarget = useTourTarget('scan');

  const load = useCallback(async () => {
    // Each section stands on its own: one failing leaves the others.
    await Promise.all([
      api.tastings().then((r) => setCellar(held(r.tastings)), () => setCellar([])),
      loc.near
        ? api.recommendations({ near: loc.near }).then((r) => setNear(r.mode === 'profile' && r.near?.applied !== false ? r.items.slice(0, 3) : []), () => setNear([]))
        : Promise.resolve(setNear(null)),
      api.savedPicks().then((r) => setLists(r.saved.slice(0, 3)), () => setLists([])),
      api.community({ limit: 2 }).then((r) => setNotes(r.notes), () => setNotes([])),
    ]);
  }, [api, loc.near]);
  useFocusEffect(useCallback(() => void load(), [load]));
  const pull = usePullRefresh(load);

  // Nothing opens over the opening animation. Then: someone new goes to Welcome (imports, the taste quiz).
  // The tour never starts by itself: only when asked (?tour=1, from Welcome, Settings or the card below).
  const [offerTour, setOfferTour] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void afterIntro().then(async () => {
      if (cancelled) return;
      if (params.tour === '1') {
        scroll.current?.scrollTo({ y: 0, animated: false });
        setTouring(true);
        return;
      }
      const [done, o] = await Promise.all([tour.done(), api.onboarding().catch(() => null)]);
      if (cancelled) return;
      if (o && !o.doneAt && o.tastings === 0) return void router.push('/welcome');
      setOfferTour(!done);
    });
    return () => {
      cancelled = true;
    };
  }, [api, params.tour]);
  const tourDone = useCallback(() => {
    setTouring(false);
    setOfferTour(false);
    void tour.finish();
    if (params.tour) router.setParams({ tour: undefined });
  }, [params.tour]);

  const find = (occasion?: string) => router.push(occasion ? `/find?occasion=${occasion}` : '/find');
  const bottles = cellar?.reduce((s, h) => s + h.bottles, 0) ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120, gap: space[6] }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.ink3} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text accessibilityRole="header" style={[type.wordmark, { color: c.accent }]}>WineTracker</Text>
          <ProfileButton />
        </View>

        {offerTour ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.headline, { color: c.ink }]}>New here?</Text>
              <Muted>A one-minute look at what WineTracker does.</Muted>
            </View>
            <Button title="Not now" variant="plain" size="sm" onPress={tourDone} />
            <Button title="Take the tour" variant="tinted" size="sm" onPress={() => { scroll.current?.scrollTo({ y: 0, animated: false }); setOfferTour(false); setTouring(true); }} />
          </Card>
        ) : null}

        <View ref={promptTarget} collapsable={false}>
          <Card style={{ gap: space[3], padding: space[5] }}>
            <Text accessibilityRole="header" style={[type.title2, { color: c.ink }]}>{`What would you like to drink ${when}?`}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {OCCASIONS.map((o) => <Chip key={o.key} onPress={() => find(o.key)}>{o.label[when]}</Chip>)}
            </View>
            <Button title="Find a bottle" icon={(fg) => <SparkleIcon color={fg} size={18} />} onPress={() => find()} />
            <Muted style={type.footnote}>From your cellar first, then shops near you.</Muted>
          </Card>
        </View>

        <View ref={scanTarget} collapsable={false}>
          <Card style={{ gap: space[3] }}>
            <View style={{ gap: 2 }}>
              <Text accessibilityRole="header" style={[type.title3, { color: c.ink }]}>Out and about?</Text>
              <Muted style={type.footnote}>{'Photograph a wine list or a shelf. We’ll rank it for your taste and flag the good value.'}</Muted>
            </View>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <ScanButton title="Wine list" detail="Restaurant or bar" Icon={ListIcon} onPress={() => router.push('/picks?kind=list')} />
              <ScanButton title="Store shelf" detail="Price tags in view" Icon={ShelfIcon} onPress={() => router.push('/picks?kind=shelf')} />
            </View>
            <Button title="Upload a list as a PDF" variant="plain" size="sm" icon={(fg) => <DocumentIcon color={fg} size={16} />} onPress={() => router.push('/picks?kind=list&start=pdf')} />
          </Card>
        </View>

        <Section title="In your cellar" meta={cellar?.length ? `${bottles} ${bottles === 1 ? 'bottle' : 'bottles'} · ${cellar.length} ${cellar.length === 1 ? 'wine' : 'wines'}` : undefined} action={cellar?.length ? { label: 'See all', onPress: () => router.navigate('/cellar') } : undefined}>
          {cellar === null ? null : cellar.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space[4] }} contentContainerStyle={{ paddingHorizontal: space[4], gap: space[3] }}>
              {cellar.slice(0, 10).map((h) => <Tile key={h.wineId} h={h} />)}
            </ScrollView>
          ) : (
            <Muted style={type.subhead}>No bottles yet. Tap + to scan a label, then choose “In my cellar”.</Muted>
          )}
        </Section>

        <Section title="Worth buying near you" meta={loc.here ? `In shops near ${loc.here.label}` : undefined} action={near?.length ? { label: 'More', onPress: () => router.navigate('/discover') } : undefined}>
          {!loc.near ? (
            <Card style={{ gap: space[2] }}>
              <Muted style={type.subhead}>Turn on Location to see what shops near you have that suits your taste.</Muted>
              <Button title="Location settings" variant="secondary" size="sm" onPress={() => router.push('/settings')} />
            </Card>
          ) : near === null ? null : near.length ? (
            <Card flush>
              {near.map((r, i) => (
                <View key={r.wineId}>
                  {i ? <Divider style={{ marginLeft: space[4] + size.thumbW + space[3] }} /> : null}
                  <NearRow r={r} />
                </View>
              ))}
            </Card>
          ) : (
            <Muted style={type.subhead}>Nothing near you matches yet. Rate a few more wines, or try Discover.</Muted>
          )}
        </Section>

        {notes?.length ? (
          <Section title="From the community" meta="What people are drinking, in their words" action={{ label: 'View all', onPress: () => router.push('/community') }}>
            <View style={{ gap: space[3] }}>
              {notes.map((n) => <NoteCard key={n.noteId} note={n} onChanged={load} />)}
            </View>
          </Section>
        ) : null}

        {lists?.length ? (
          <Section title="Your lists" meta="Reopen one to rank it for your taste now" action={{ label: 'All lists', onPress: () => router.push('/lists') }}>
            <Card flush>
              {lists.map((p, i) => (
                <View key={p.pickId}>
                  {i ? <Divider style={{ marginLeft: space[4] + 44 + space[3] }} /> : null}
                  <ListRow p={p} />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
      <Tour visible={touring} onDone={tourDone} />
    </View>
  );

}

/** One wine on the cellar shelf: the bottle on its wash, how many, the vintages and its value. */
function Tile({ h }: { h: Held }) {
  const { c, scheme } = useTheme();
  const ws = wineStyleOf(h.wine.colour, h.wine.wine_type);
  const value = h.wine.market_now_cents;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${wineTitle(h.wine.display_name)}, ${h.bottles} ${h.bottles === 1 ? 'bottle' : 'bottles'}`}
      onPress={() => router.push(`/wine/${h.wineId}`)}
      style={({ pressed }) => [{ width: 112, gap: space[1] }, pressed && { opacity: 0.85 }]}
    >
      <View style={[{ borderRadius: radius.md, backgroundColor: c.wash[ws], padding: space[2] }, lift(scheme, 'card')]}>
        <WinePhoto uri={h.wine.image_url} wineStyle={ws} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.sm, backgroundColor: 'transparent' }} padding={6} />
        {h.bottles > 1 ? (
          <View style={{ position: 'absolute', top: space[2], right: space[2], paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.xs, backgroundColor: c.surface }}>
            <Text style={[type.figure, { fontSize: 12, lineHeight: 18, color: c.ink }]}>{`×${h.bottles}`}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[type.wineTitle, { fontSize: 15, lineHeight: 19, color: c.ink }]} numberOfLines={2}>{wineTitle(h.wine.display_name)}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.footnote, { color: c.ink2 }]}>{h.vintages.slice(0, 2).join(', ')}</Text>
        {value ? <Text style={[type.figure, { fontSize: 13, lineHeight: 18, color: c.ink2 }]}>{dollars(value)}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A wine a shop near you has, with the shop and the price. */
function NearRow({ r }: { r: Recommendation }) {
  const { c } = useTheme();
  const ws = wineStyleOf(r.colour, r.wineType);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.displayName}, ${dollars(r.medianCents)}. ${r.fit ? fitWords(r.fit) : ''} ${r.reasons[0] ?? ''}`}
      onPress={() => router.push(`/wine/${r.wineId}`)}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.row, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
    >
      <WineThumb uri={r.imageUrl} wineStyle={ws} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={1}>{wineTitle(r.displayName)}</Text>
        <Text style={[type.footnote, { color: c.ink2 }]} numberOfLines={1}>{r.nearby ? nearbyLabel(r.nearby) : r.reasons[0] ?? r.region}</Text>
        <FitBadge fit={r.fit} compact />
      </View>
      <Text style={[type.figure, { color: c.ink }]}>{dollars(r.medianCents)}</Text>
    </Pressable>
  );
}

/** A saved wine list or shelf. */
function ListRow({ p }: { p: SavedPick }) {
  const { c } = useTheme();
  const Icon = p.kind === 'shelf' ? ShelfIcon : ListIcon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${p.wines} wines`}
      onPress={() => router.push(`/picks?id=${p.pickId}`)}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.row, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: c.fillQuiet, alignItems: 'center', justifyContent: 'center' }}>
        <Icon color={c.ink2} size={22} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: c.ink }]} numberOfLines={1}>{p.name}</Text>
        <Text style={[type.footnote, { color: c.ink2 }]} numberOfLines={1}>{`${shortDate(p.savedAt)} · ${p.wines} wines${p.topPick ? ` · top pick ${p.topPick}` : ''}`}</Text>
      </View>
      <ChevronIcon color={c.ink3} />
    </Pressable>
  );
}

/** Wine list / Store shelf: the two ways in to picks, side by side. */
function ScanButton({ title, detail, Icon, onPress }: { title: string; detail: string; Icon: (p: { color: string; size?: number }) => ReactElement; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, padding: space[3], gap: space[2], borderRadius: radius.md, backgroundColor: c.fillQuiet }, pressed && { opacity: 0.85 }]}
    >
      <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon color={c.onAccent} size={22} />
      </View>
      <View style={{ gap: 1 }}>
        <Text style={[type.headline, { color: c.ink }]}>{title}</Text>
        <Text style={[type.footnote, { color: c.ink2 }]}>{detail}</Text>
      </View>
    </Pressable>
  );
}

/** A section's title, what it holds, and an optional action on the right. */
function Section({ title, meta, action, children }: { title: string; meta?: string; action?: { label: string; onPress: () => void }; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space[2] }}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[type.title3, { color: c.ink }]}>{title}</Text>
          {meta ? <Text style={[type.footnote, { color: c.ink2 }]}>{meta}</Text> : null}
        </View>
        {action ? <Button title={action.label} variant="plain" size="sm" onPress={action.onPress} /> : null}
      </View>
      {children}
    </View>
  );
}
