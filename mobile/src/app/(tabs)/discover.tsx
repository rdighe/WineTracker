/**
 * Discover: wines picked from the user's ratings, a few of every style they've liked,
 * with a filter for each style. Refresh re-reads the ratings (styles, prices,
 * tasting notes); Find wines searches by price, style, region, tasting notes
 * and food, and a search can be saved as a view to come back to. Nothing is
 * suggested until there are enough ratings to be personal.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExpandingSheet, measure, type Rect } from '../../components/ExpandingSheet';
import { Glass } from '../../components/Glass';
import { PinIcon, RefreshIcon, SearchIcon, SparkleIcon } from '../../components/icons';
import { RecSearchForm, describeSearch } from '../../components/RecSearchForm';
import { Bone, Skeleton } from '../../components/Skeleton';
import { WinePhoto } from '../../components/WineThumb';
import { Button, Card, Chip, ErrorText, Field, Heading, Label, Muted, Title, radius, space, type, useTheme, wineStyleOf } from '../../components/ui';
import type { WineStyle } from '../../components/theme';
import { dollars } from '../../lib/format';
import type { RecSearch, RecStyle, RecView, Recommendation, RecommendationsResponse, TasteSummary } from '../../lib/types';
import { useApi } from '../../lib/useApi';
import { FitBadge, fitWords } from '../../components/FitBadge';
import { useLocation } from '../../lib/location';
import { NearBar, nearNote, nearbyLabel } from '../../components/NearBar';
import { ProfileButton } from '../../components/ProfileButton';

type Filter = 'all' | 'value' | RecStyle;
/** Your picks, or a search (a saved view has its id and name). */
type View_ = { kind: 'picks' } | { kind: 'search'; criteria: RecSearch; saved?: RecView };

const STYLE_LABEL: Record<RecStyle, string> = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', orange: 'Orange', sweet: 'Dessert' };
/** The color dot for each style (sweet wines share the fortified color). */
const STYLE_DOT: Record<RecStyle, WineStyle> = { red: 'red', white: 'white', rose: 'rose', sparkling: 'sparkling', orange: 'orange', sweet: 'fortified' };
const FILTERS: { key: Filter; label: string; dot?: WineStyle }[] = [
  { key: 'all', label: 'All' },
  { key: 'value', label: 'Best value' },
  ...(['red', 'white', 'sparkling', 'sweet'] as const).map((s) => ({ key: s, label: STYLE_LABEL[s], dot: STYLE_DOT[s] })),
];

export default function Discover() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [view, setView] = useState<View_>({ kind: 'picks' });
  const [filter, setFilter] = useState<Filter>('all');
  // The answer, and which filter or search it answers: a list never shows under the wrong filter.
  const [result, setResult] = useState<{ key: string; res: RecommendationsResponse } | null>(null);
  const [summary, setSummary] = useState<TasteSummary | null>(null);
  const [saved, setSaved] = useState<RecView[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<{ origin: Rect; closing: boolean } | null>(null);
  const findButton = useRef<View>(null);
  // Near you: on whenever a location is known, unless switched to Anywhere.
  const loc = useLocation();
  const [anywhere, setAnywhere] = useState(false);
  const near = anywhere ? undefined : loc.near;

  const searching = view.kind === 'search';
  const listKey = `${searching ? `search-${JSON.stringify(view.criteria)}` : filter}|${near ?? ''}`;
  // Only the latest request's answer counts: tapping filters quickly never leaves an older list on screen.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.recommendations({
        ...(view.kind === 'search' ? view.criteria : filter === 'all' || filter === 'value' ? { bestValue: filter === 'value' } : { style: filter }),
        near,
      });
      if (mine !== latest.current) return;
      setResult({ key: listKey, res });
      if (res.mode === 'profile' && res.summary) setSummary(res.summary);
    } catch (e) {
      if (mine === latest.current) setError(e);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [api, filter, view, listKey, near]);
  const loadSaved = useCallback(() => {
    api.recViews().then((r) => setSaved(r.views), () => setSaved([]));
  }, [api]);
  useFocusEffect(useCallback(() => {
    void load();
    loadSaved();
  }, [load, loadSaved]));

  // "Updated" shows for a moment after a refresh.
  useEffect(() => {
    if (!refreshed) return;
    const t = setTimeout(() => setRefreshed(false), 2400);
    return () => clearTimeout(t);
  }, [refreshed]);

  async function reevaluate() {
    setView({ kind: 'picks' });
    setFilter('all');
    // The view and filter may already be these, so load doesn't change; reload either way.
    await load();
    setRefreshed(true);
  }

  async function openFind() {
    const origin = (await measure(findButton)) ?? { x: space[4], y: insets.top + 80, width: 140, height: 34 };
    setSheet({ origin, closing: false });
  }
  const closeSheet = () => setSheet((s) => (s ? { ...s, closing: true } : s));
  const sheetClosed = useCallback(() => setSheet(null), []);

  const data = result?.res ?? null;
  const locked = data?.mode === 'locked';
  // A new filter or search: placeholders until its own answer arrives.
  const current = result?.key === listKey ? data : null;
  const waiting = !current && !error;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120, gap: space[5] }}
        columnWrapperStyle={{ gap: space[3] }}
        numColumns={2}
        data={current?.items ?? []}
        // Each filter's or search's list fades in as a new list.
        key={listKey}
        keyExtractor={(r) => `${listKey}-${r.wineId}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.ink3} />}
        ListHeaderComponent={
          <View style={{ gap: space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] }}>
              <View style={{ flex: 1 }}>
                <Title>Discover</Title>
                <Muted style={{ marginTop: 2 }}>{summary ? basedOn(summary) : 'From your ratings'}</Muted>
              </View>
              <ProfileButton />
            </View>
            {locked ? (
              <LockedCard rated={data.rated} needed={data.needed} />
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    title={refreshed ? 'Updated' : 'Refresh picks'}
                    busy={loading && !searching && filter === 'all'}
                    accessibilityLabel="Refresh picks from your ratings"
                    icon={(color) => <RefreshIcon color={color} size={15} />}
                    onPress={reevaluate}
                  />
                  <View ref={findButton} collapsable={false}>
                    <Button size="sm" variant="tinted" title="Find wines" icon={(color) => <SearchIcon color={color} size={15} />} onPress={openFind} />
                  </View>
                  <Button size="sm" variant="secondary" title="Your taste" onPress={() => router.push('/taste')} />
                </View>
                {saved.length ? (
                  <View style={{ gap: space[2] }}>
                    <Label>Saved views</Label>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space[4] }} contentContainerStyle={{ gap: space[2], paddingHorizontal: space[4] }}>
                      {saved.map((v) => (
                        <Chip key={v.viewId} small selected={searching && view.saved?.viewId === v.viewId} onPress={() => setView({ kind: 'search', criteria: v.criteria, saved: v })}>
                          {v.name}
                        </Chip>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
                {searching ? (
                  <SearchBanner
                    key={JSON.stringify(view.criteria)}
                    criteria={view.criteria}
                    saved={view.saved}
                    onEdit={openFind}
                    onClose={() => setView({ kind: 'picks' })}
                    onSave={async (name) => {
                      const v = await api.saveRecView(name, view.criteria);
                      setSaved((s) => [v, ...s]);
                      setView({ kind: 'search', criteria: v.criteria, saved: v });
                    }}
                    onDelete={async (v) => {
                      await api.deleteRecView(v.viewId);
                      setSaved((s) => s.filter((x) => x.viewId !== v.viewId));
                      setView({ kind: 'search', criteria: v.criteria });
                    }}
                  />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space[4] }} contentContainerStyle={{ gap: space[2], paddingHorizontal: space[4] }}>
                    {FILTERS.map((f) => (
                      <Chip key={f.key} small dot={f.dot} selected={filter === f.key} onPress={() => setFilter(f.key)}>{f.label}</Chip>
                    ))}
                  </ScrollView>
                )}
                <NearBar on={!anywhere} onChange={(on) => setAnywhere(!on)} />
                {current?.mode === 'profile' && nearNote(current.near, 'wines') ? <Muted>{nearNote(current.near, 'wines')}</Muted> : null}
              </>
            )}
            <ErrorText error={error} />
          </View>
        }
        ListEmptyComponent={waiting && !locked ? <CardBones /> : current?.mode === 'profile' && !loading ? (
          <Muted style={type.subhead}>
            {searching
              ? 'No wines in stock match that yet. Try a wider price range or fewer details.'
              : filter === 'all' || filter === 'value'
                ? 'Nothing to suggest yet. Rate a few more wines.'
                : `No ${STYLE_LABEL[filter].toLowerCase()} wines in stock that fit yet.`}
          </Muted>
        ) : null}
        renderItem={({ item: r, index }) => <WineCard r={r} index={index} />}
      />

      {sheet ? (
        <ExpandingSheet overTabs origin={sheet.origin} label="Find wines" title="Find wines" closing={sheet.closing} onRequestClose={closeSheet} onClosed={sheetClosed}>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" bottomOffset={24} contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: insets.bottom + space[6] }}>
            <RecSearchForm
              initial={searching ? view.criteria : {}}
              onSubmit={(criteria) => {
                // Same search as a saved view: show it as that view.
                const match = saved.find((v) => JSON.stringify(v.criteria) === JSON.stringify(criteria));
                setView({ kind: 'search', criteria, saved: match });
                closeSheet();
              }}
            />
          </KeyboardAwareScrollView>
        </ExpandingSheet>
      ) : null}
    </View>
  );
}

/** "From 12 rated wines · Red, White · usually $40–$90 · cherry, earthy" */
function basedOn(s: TasteSummary): string {
  const price = s.priceLowCents && s.priceHighCents ? `usually ${dollars(s.priceLowCents)}–${dollars(s.priceHighCents)}` : '';
  return [
    `From ${s.rated} rated ${s.rated === 1 ? 'wine' : 'wines'}`,
    s.styles.slice(0, 3).map((k) => STYLE_LABEL[k]).join(', '),
    price,
    s.flavors.slice(0, 3).join(', ').toLowerCase(),
  ].filter(Boolean).join(' · ');
}

/** What the search asked for, with Edit, Save view (or Delete for a saved one) and close. */
function SearchBanner({ criteria, saved, onEdit, onClose, onSave, onDelete }: {
  criteria: RecSearch; saved?: RecView; onEdit: () => void; onClose: () => void;
  onSave: (name: string) => Promise<void>; onDelete: (v: RecView) => Promise<void>;
}) {
  const { c } = useTheme();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(() => describeSearch(criteria).slice(0, 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNaming(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <Card style={{ gap: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Label style={{ color: c.accent }}>{saved ? 'Saved view' : 'Search'}</Label>
            <Heading numberOfLines={2}>{saved?.name ?? describeSearch(criteria)}</Heading>
            {saved ? <Muted numberOfLines={2}>{describeSearch(criteria)}</Muted> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to your picks"
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.fillQuiet, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
          >
            <Text style={[type.headline, { color: c.ink2, lineHeight: 20 }]}>×</Text>
          </Pressable>
        </View>
        {naming ? (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ gap: space[2] }}>
            <Field label="Name this view" value={name} onChangeText={setName} maxLength={60} autoFocus returnKeyType="done" onSubmitEditing={() => name.trim() && run(() => onSave(name.trim()))} />
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button size="sm" title="Save" busy={busy} disabled={!name.trim()} onPress={() => run(() => onSave(name.trim()))} />
              <Button size="sm" variant="plain" title="Cancel" onPress={() => setNaming(false)} />
            </View>
          </Animated.View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <Button size="sm" variant="secondary" title="Edit" onPress={onEdit} />
            {saved ? (
              <Button size="sm" variant="plain" title="Delete view" busy={busy} onPress={() => run(() => onDelete(saved))} />
            ) : (
              <Button size="sm" variant="tinted" title="Save view" onPress={() => setNaming(true)} />
            )}
          </View>
        )}
        <ErrorText error={error} />
      </Card>
    </Animated.View>
  );
}

function LockedCard({ rated, needed }: { rated: number; needed: number }) {
  const { c } = useTheme();
  return (
    <Card style={{ gap: 14 }}>
      <SparkleIcon color={c.accent} size={26} />
      <Heading style={type.title2}>
        Rate {needed - rated} more {needed - rated === 1 ? 'wine' : 'wines'} to unlock suggestions
      </Heading>
      <Muted style={type.subhead}>Suggestions come from what you like, so we wait until we know a little about your taste.</Muted>
      <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={`${rated} of ${needed} rated`}>
        {Array.from({ length: needed }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < rated ? c.accent : c.fillQuiet }} />
        ))}
      </View>
      <Muted style={type.tabular}>{rated} of {needed} rated</Muted>
      <Button title="Add a wine" onPress={() => router.push('/add')} />
    </Card>
  );
}

/** Two rows of card-shaped placeholders while a filter or search loads. */
function CardBones() {
  return (
    <Skeleton label="Finding wines">
      {[0, 1].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: space[3] }}>
          {[0, 1].map((col) => (
            <View key={col} style={{ flex: 1, gap: space[2] }}>
              <View style={{ aspectRatio: 4 / 5 }}><Bone height="100%" radius={radius.md} /></View>
              <Bone width="85%" height={16} />
              <Bone width="55%" />
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
  );
}

/** Photo-first tile: the bottle, its price in a glass chip, the name and why it was picked. */
function WineCard({ r, index }: { r: Recommendation; index: number }) {
  const { c } = useTheme();
  const style = r.style ? STYLE_DOT[r.style] : wineStyleOf(r.colour, r.wineType);
  return (
    <Animated.View entering={FadeInDown.duration(280).delay(Math.min(index, 8) * 45)} style={{ flex: 1, maxWidth: '50%' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${r.displayName}, ${dollars(r.medianCents)}. ${r.fit ? fitWords(r.fit) : ''} ${r.reasons[0] ?? ''}`}
        onPress={() => router.push(`/wine/${r.wineId}`)}
        style={({ pressed }) => [{ gap: space[2] }, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }]}
      >
        <WinePhoto uri={r.imageUrl} wineStyle={style} padding={space[3]} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: radius.md }}>
          <View style={{ position: 'absolute', left: space[2], bottom: space[2] }}>
            <Glass style={{ borderRadius: radius.pill }}>
              <Text style={[type.subhead, type.tabular, { fontWeight: '700', color: c.ink, paddingVertical: 5, paddingHorizontal: space[3] }]}>{dollars(r.medianCents)}</Text>
            </Glass>
          </View>
        </WinePhoto>
        <View style={{ gap: 2, paddingHorizontal: 2 }}>
          <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{r.displayName}</Text>
          <Muted numberOfLines={1}>
            {[r.region, r.country].filter(Boolean).join(' · ')}
            {r.nMerchants ? ` · ${r.nMerchants} ${r.nMerchants === 1 ? 'shop' : 'shops'}` : ''}
          </Muted>
          <View style={{ marginTop: 2 }}><FitBadge fit={r.fit} compact /></View>
          {r.nearby ? (
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
              <View style={{ marginTop: 2 }}><PinIcon color={c.positive} size={13} /></View>
              <Text style={[type.footnote, { flex: 1, color: c.positive }]} numberOfLines={1}>{nearbyLabel(r.nearby)}</Text>
            </View>
          ) : null}
          {r.reasons[0] ? (
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
              <View style={{ marginTop: 2 }}><SparkleIcon color={c.accent} size={13} /></View>
              <Text style={[type.footnote, { flex: 1, color: c.accent }]} numberOfLines={2}>{r.reasons[0]}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
