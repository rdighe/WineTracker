import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text } from 'react-native';
import { Card, ErrorText, Field, Muted, styles } from '../../components/ui';
import type { Candidate } from '../../lib/types';
import { useApi } from '../../lib/useApi';

export default function Search() {
  const api = useApi();
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
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      data={results ?? []}
      keyExtractor={(r) => String(r.wineId)}
      ListHeaderComponent={
        <>
          <Field label="Search wines" value={q} onChangeText={setQ} onSubmitEditing={run} returnKeyType="search" placeholder="Producer, wine, vintage…" autoCorrect={false} />
          <ErrorText error={error} />
        </>
      }
      ListEmptyComponent={results ? <Muted>No matches.</Muted> : null}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/wine/${item.wineId}`)}>
          <Card>
            <Text style={styles.h2}>{item.displayName}</Text>
            <Muted>{[item.region, item.country].filter(Boolean).join(', ')}</Muted>
          </Card>
        </Pressable>
      )}
    />
  );
}
