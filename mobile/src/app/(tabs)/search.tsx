/** Search the catalog by producer, wine or vintage. */
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SearchIcon } from '../../components/icons';
import { Card, ErrorText, Muted, Title, colors, fonts, styles, useScreenPadding } from '../../components/ui';
import type { Candidate } from '../../lib/types';
import { useApi } from '../../lib/useApi';

export default function Search() {
  const api = useApi();
  const padding = useScreenPadding();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    if (q.trim().length < 2) return;
    setError(null);
    try {
      setResults((await api.search(q.trim())).results);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
      data={results ?? []}
      keyExtractor={(r) => String(r.wineId)}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <Title>Search</Title>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
            <SearchIcon color={colors.muted} size={20} />
            <TextInput
              accessibilityLabel="Search wines"
              value={q}
              onChangeText={setQ}
              onSubmitEditing={run}
              returnKeyType="search"
              placeholder="Producer, wine, vintage…"
              placeholderTextColor={colors.faint}
              autoCorrect={false}
              style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text }}
            />
          </View>
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={results ? <Muted>No matches.</Muted> : null}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/wine/${item.wineId}`)} style={({ pressed }) => [{ marginBottom: 10 }, pressed && { opacity: 0.7 }]}>
          <Card style={{ padding: 16, gap: 4 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.text }}>{item.displayName}</Text>
            <Muted style={{ fontSize: 12 }}>{[item.region, item.country].filter(Boolean).join(' · ')}</Muted>
          </Card>
        </Pressable>
      )}
    />
  );
}
