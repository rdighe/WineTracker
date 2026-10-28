/**
 * My wines › Saved: the wines bookmarked on their pages, newest first or by
 * price. A row opens the wine's page, where the bookmark also removes it.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dollars, shortDate, wineTitle } from '../lib/format';
import type { SavedWine } from '../lib/types';
import { useApi } from '../lib/useApi';
import { SearchBar } from './AddSearch';
import { BookmarkIcon, ChevronIcon } from './icons';
import { WineThumb } from './WineThumb';
import { Divider, ErrorText, Muted, Segmented, Title, radius, size, space, type, useTheme, wineStyleOf } from './ui';

type Sort = 'recent' | 'price';

/** Lowercase without accents, so "rose" finds Rosé. */
const normalizeForSearch = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function SavedWines({ modeSwitch }: { modeSwitch: ReactNode }) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [rows, setRows] = useState<SavedWine[] | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows((await api.saved()).saved);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api]);
  // Again on every visit: a wine may have been saved or removed on its page.
  useFocusEffect(useCallback(() => void load(), [load]));

  const visible = useMemo(() => {
    const q = normalizeForSearch(query);
    const list = (rows ?? []).filter((w) => !q || normalizeForSearch(`${w.display_name} ${w.producer} ${w.region} ${w.sub_region} ${w.country}`).includes(q));
    if (sort === 'price') list.sort((a, b) => (a.median_cents ?? Infinity) - (b.median_cents ?? Infinity));
    return list;
  }, [rows, query, sort]);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120 }}
      data={visible}
      key="saved"
      keyExtractor={(w) => `saved-${w.wine_id}`}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.ink3} />}
      ListHeaderComponent={
        <View style={{ gap: space[4], marginBottom: space[4] }}>
          <View>
            <Title>My wines</Title>
            <Muted style={{ marginTop: 2 }}>{rows ? `${rows.length} saved ${rows.length === 1 ? 'wine' : 'wines'}` : ' '}</Muted>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
            <Segmented<Sort> small options={[{ key: 'recent', label: 'Recent' }, { key: 'price', label: 'Price' }]} value={sort} onChange={setSort} />
            {modeSwitch}
          </View>
          {rows?.length ? (
            <View style={{ flexDirection: 'row' }}>
              <SearchBar value={query} onChangeText={setQuery} placeholder="Search saved wines" />
            </View>
          ) : null}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={
        rows && query.trim() ? (
          <Muted>No saved wines match.</Muted>
        ) : rows ? (
          <View style={{ gap: space[2], alignItems: 'flex-start' }}>
            <BookmarkIcon color={c.ink3} size={22} />
            <Muted style={type.subhead}>Nothing saved yet. Tap the bookmark on a wine’s page to keep it here for later.</Muted>
          </View>
        ) : null
      }
      renderItem={({ item: w, index }) => <SavedRow w={w} index={index} first={index === 0} last={index === visible.length - 1} />}
    />
  );
}

/** Same grouped-list row as the cellar: thumbnail, name, region · when saved, the market price; opens the wine. */
function SavedRow({ w, index, first, last }: { w: SavedWine; index: number; first: boolean; last: boolean }) {
  const { c } = useTheme();
  const name = wineTitle(w.display_name, w.sub_region);
  // "Saved 27 Oct": the year only matters once it isn't this one.
  const when = shortDate(w.created_at).replace(` ${new Date().getFullYear()}`, '');
  const line = [w.sub_region || w.region, `Saved ${when}`].filter(Boolean).join(' · ');
  return (
    <Animated.View
      entering={FadeInDown.duration(260).delay(Math.min(index, 8) * 30)}
      style={{
        backgroundColor: c.surface, borderColor: c.hairline, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
        borderTopWidth: first ? StyleSheet.hairlineWidth : 0, borderBottomWidth: last ? StyleSheet.hairlineWidth : 0,
        borderTopLeftRadius: first ? radius.md : 0, borderTopRightRadius: first ? radius.md : 0,
        borderBottomLeftRadius: last ? radius.md : 0, borderBottomRightRadius: last ? radius.md : 0, overflow: 'hidden',
      }}
    >
      {first ? null : <Divider style={{ marginLeft: space[4] + size.thumbW + space[3] }} />}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the wine page"
        accessibilityLabel={`${name}, ${line}${w.median_cents ? `, ${dollars(w.median_cents)}` : ''}`}
        onPress={() => router.push(`/wine/${w.wine_id}`)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.rowPhoto, paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
      >
        <WineThumb uri={w.image_url} wineStyle={wineStyleOf(w.colour, w.wine_type)} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{name}</Text>
          <Text style={[type.subhead, { color: c.ink2 }]} numberOfLines={1}>{line}</Text>
        </View>
        {w.median_cents ? <Text style={[type.figure, { color: c.ink }]}>{dollars(w.median_cents)}</Text> : <Muted style={{ color: c.ink3 }}>No price</Muted>}
        <ChevronIcon color={c.ink3} />
      </Pressable>
    </Animated.View>
  );
}
