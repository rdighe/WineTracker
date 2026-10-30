/**
 * Community notes: what people who use WineTracker thought of wines, newest
 * first (Home › From the community › View all). ?wine= narrows it to one
 * wine (from its page); ?note= opens one note with its replies, to read and
 * reply. ?mine=1 lists your own shared notes.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirm } from '../components/EntryRows';
import { NoteCard } from '../components/NoteCard';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button, Card, Chip, ErrorText, Muted, space, type, useStyles, useTheme } from '../components/ui';
import { ago } from '../lib/format';
import type { CommunityNote, NoteReply } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function Community() {
  const params = useLocalSearchParams<{ wine?: string; note?: string; mine?: string }>();
  if (params.note) return <NoteThread noteId={Number(params.note)} />;
  return <Feed wineId={params.wine ? Number(params.wine) : undefined} mine={params.mine === '1'} />;
}

function Feed({ wineId, mine }: { wineId?: number; mine: boolean }) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const [notes, setNotes] = useState<CommunityNote[] | null>(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.community({ wineId, mine, limit: 20 });
      setNotes(r.notes);
      setMore(r.notes.length === 20);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api, wineId, mine]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function next() {
    if (!notes?.length || !more || loading) return;
    setLoading(true);
    try {
      const r = await api.community({ wineId, mine, limit: 20, before: notes[notes.length - 1]!.noteId });
      setNotes([...notes, ...r.notes]);
      setMore(r.notes.length === 20);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  const title = mine ? 'Your shared notes' : wineId ? (notes?.[0] ? notes[0].wine.displayName : 'Community notes') : 'From the community';
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 80, gap: space[3] }}
      data={notes ?? []}
      keyExtractor={(n) => String(n.noteId)}
      refreshControl={<RefreshControl refreshing={loading && notes !== null} onRefresh={load} tintColor={c.ink3} />}
      onEndReached={() => void next()}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <View style={{ gap: space[3], marginBottom: space[2] }}>
          <ScreenHeader title={title} subtitle={mine ? 'What you have shared, and how people responded' : wineId ? 'What people who drank it thought' : 'What people are drinking, in their words'} />
          {!wineId ? (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip small selected={!mine} onPress={() => router.setParams({ mine: undefined })}>Everyone</Chip>
              <Chip small selected={mine} onPress={() => router.setParams({ mine: '1' })}>Yours</Chip>
            </View>
          ) : null}
          <ErrorText error={error} />
        </View>
      }
      ListEmptyComponent={notes ? (
        <Muted style={type.subhead}>
          {mine ? 'Share a tasting from your Journal and it shows up here.' : wineId ? 'No notes on this wine yet. Taste it and share yours.' : 'No notes yet. Share a tasting from your Journal to start.'}
        </Muted>
      ) : <ActivityIndicator color={c.ink3} />}
      renderItem={({ item }) => <NoteCard note={item} onChanged={load} />}
    />
  );
}

function NoteThread({ noteId }: { noteId: number }) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { c, scheme } = useTheme();
  const s = useStyles();
  const [data, setData] = useState<{ note: CommunityNote; replies: NoteReply[] } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.communityNote(noteId));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api, noteId]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.replyToNote(noteId, text);
      setText('');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function replyMenu(r: NoteReply) {
    if (r.author.me || data?.note.author.me) {
      if (await confirm('Delete this reply?', '', 'Delete')) {
        await api.deleteReply(r.replyId).catch(setError);
        await load();
      }
    } else {
      Alert.alert(r.author.name, undefined, [
        { text: 'Report', onPress: () => void api.reportReply(r.replyId).then(() => { Alert.alert('Reported', 'Thanks. Replies several people report are hidden.'); return load(); }, setError) },
        { text: `Block ${r.author.name}`, style: 'destructive', onPress: () => void api.blockReplyAuthor(r.replyId).then(load, setError) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: 80, gap: space[3] }}
      data={data?.replies ?? []}
      keyExtractor={(r) => String(r.replyId)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: space[3] }}>
          <ScreenHeader title="Note" />
          <ErrorText error={error} />
          {data ? <NoteCard note={data.note} open onChanged={() => router.back()} /> : <ActivityIndicator color={c.ink3} />}
          {data ? <Text style={[type.headline, { color: c.ink, marginTop: space[2] }]}>{data.replies.length ? `${data.replies.length} ${data.replies.length === 1 ? 'reply' : 'replies'}` : 'No replies yet'}</Text> : null}
        </View>
      }
      renderItem={({ item: r }) => (
        <Pressable accessibilityRole="button" accessibilityHint={r.author.me || data?.note.author.me ? 'Hold to delete' : 'Hold to report or block'} onLongPress={() => void replyMenu(r)}>
          <Card style={{ gap: space[1] }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[type.subhead, { fontWeight: '600', color: c.ink }]}>{r.author.me ? `${r.author.name} (you)` : r.author.name}</Text>
              <Muted>{ago(r.createdAt)}</Muted>
            </View>
            <Text style={[type.body, { color: c.ink2 }]}>{r.body}</Text>
          </Card>
        </Pressable>
      )}
      ListFooterComponent={data ? (
        <View style={{ gap: space[2], marginTop: space[2] }}>
          <TextInput
            accessibilityLabel="Reply"
            value={text}
            onChangeText={setText}
            placeholder="Reply…"
            placeholderTextColor={c.ink3}
            keyboardAppearance={scheme}
            multiline
            maxLength={600}
            style={[s.input, { minHeight: 44, paddingTop: 12, color: c.ink }]}
          />
          <Button title="Reply" variant="tinted" size="md" busy={busy} disabled={!text.trim()} onPress={() => void send()} />
          <Muted style={{ color: c.ink3 }}>Hold a reply to delete yours, or to report or block someone else&apos;s.</Muted>
        </View>
      ) : null}
    />
  );
}
