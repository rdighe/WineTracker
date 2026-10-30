/** The wine page's community notes: the latest two, all of them, and sharing your own. */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { CommunityNote } from '../lib/types';
import { useApi } from '../lib/useApi';
import { NoteCard } from './NoteCard';
import { Button, Heading, Muted, space } from './ui';

export function WineNotes({ wineId, vintage }: { wineId: number; vintage?: string | null }) {
  const api = useApi();
  const [notes, setNotes] = useState<CommunityNote[] | null>(null);
  const load = useCallback(() => {
    api.community({ wineId, limit: 3 }).then((r) => setNotes(r.notes), () => setNotes([]));
  }, [api, wineId]);
  useFocusEffect(useCallback(() => load(), [load]));
  if (!notes) return null;
  return (
    <View style={{ gap: space[3] }}>
      <Heading>Community notes</Heading>
      {notes.length ? notes.slice(0, 2).map((n) => <NoteCard key={n.noteId} note={n} onChanged={load} />) : <Muted>No one has shared a note on this wine yet.</Muted>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {notes.length > 2 ? <Button title="All notes" variant="secondary" size="sm" onPress={() => router.push(`/community?wine=${wineId}`)} /> : null}
        <Button title="Share yours" variant="tinted" size="sm" onPress={() => router.push(`/share-note?wine=${wineId}${vintage ? `&vintage=${vintage}` : ''}`)} />
      </View>
    </View>
  );
}
