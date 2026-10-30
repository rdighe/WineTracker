/**
 * Lists (from Home › Your lists): what to order or buy when you're out. Photograph a restaurant wine
 * list or a store shelf to see its wines ranked for your palate (app/picks.tsx),
 * and come back to the lists and shelves you saved, with their photos.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackIcon, ListIcon, ShelfIcon } from '../components/icons';
import { PickPhoto } from '../components/PickPhoto';
import { ErrorText, IconButton, Label, Muted, Title, radius, space, type, useTheme } from '../components/ui';
import { lift } from '../components/Glass';
import { shortDate } from '../lib/format';
import type { SavedPick } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function Lists() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [saved, setSaved] = useState<SavedPick[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSaved((await api.savedPicks()).saved);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 120, gap: space[4] }}
        columnWrapperStyle={{ gap: space[3] }}
        numColumns={2}
        data={saved ?? []}
        keyExtractor={(p) => String(p.pickId)}
        refreshControl={<RefreshControl refreshing={loading && saved !== null} onRefresh={load} tintColor={c.ink3} />}
        ListHeaderComponent={
          <View style={{ gap: space[4] }}>
            <View style={{ marginLeft: -space[2], marginBottom: -space[2] }}>
              <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
                <BackIcon color={c.ink} size={20} />
              </IconButton>
            </View>
            <View>
              <Title>Lists</Title>
              <Muted style={{ marginTop: 2 }}>The best wines for you on a menu or a shelf</Muted>
            </View>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <Action title="Wine list" detail="At a restaurant" Icon={ListIcon} onPress={() => router.push('/picks?kind=list')} />
              <Action title="Store shelf" detail="At a shop" Icon={ShelfIcon} onPress={() => router.push('/picks?kind=shelf')} />
            </View>
            <ErrorText error={error} />
            {saved?.length ? <Label>Saved</Label> : null}
          </View>
        }
        ListEmptyComponent={saved ? (
          <Muted style={type.subhead}>Lists and shelves you save show up here, with their photos and the best picks for you.</Muted>
        ) : null}
        renderItem={({ item }) => <SavedCard pick={item} />}
      />
    </View>
  );
}

function Action({ title, detail, Icon, onPress }: { title: string; detail: string; Icon: (p: { color: string; size?: number }) => React.ReactElement; onPress: () => void }) {
  const { c, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        { flex: 1, padding: space[4], gap: space[3], borderRadius: radius.lg, backgroundColor: c.surface },
        lift(scheme, 'card'),
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon color={c.onAccentSoft} size={24} />
      </View>
      <View style={{ gap: 2 }}>
        <Text style={[type.headline, { color: c.ink }]}>{title}</Text>
        <Text style={[type.footnote, { color: c.ink2 }]}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function SavedCard({ pick }: { pick: SavedPick }) {
  const { c, scheme } = useTheme();
  const Icon = pick.kind === 'shelf' ? ShelfIcon : ListIcon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pick.name}, ${pick.wines} wines`}
      onPress={() => router.push(`/picks?id=${pick.pickId}`)}
      style={({ pressed }) => [{ flex: 1, maxWidth: '50%', borderRadius: radius.lg, backgroundColor: c.surface, overflow: 'hidden' }, lift(scheme, 'card'), pressed && { opacity: 0.85 }]}
    >
      {pick.photos ? (
        <PickPhoto pickId={pick.pickId} n={0} style={{ width: '100%', aspectRatio: 3 / 4 }} />
      ) : (
        <View style={{ width: '100%', aspectRatio: 3 / 4, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon color={c.ink3} size={36} />
        </View>
      )}
      <View style={{ padding: space[3], gap: 2 }}>
        <Text style={[type.headline, { color: c.ink }]} numberOfLines={1}>{pick.name}</Text>
        <Text style={[type.footnote, { color: c.ink2 }]} numberOfLines={1}>{`${shortDate(pick.savedAt)} · ${pick.wines} wine${pick.wines === 1 ? '' : 's'}`}</Text>
        {pick.topPick ? <Text style={[type.footnote, { color: c.ink3 }]} numberOfLines={2}>{`Top pick: ${pick.topPick}`}</Text> : null}
      </View>
    </Pressable>
  );
}
