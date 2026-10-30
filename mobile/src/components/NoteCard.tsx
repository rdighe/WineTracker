/**
 * A community note: who shared it (their public name), when, the wine, how
 * they liked it and whether it was ready - in words, never a score - what
 * they wrote, and likes and replies. ⋯ edits or deletes your own, or
 * reports someone else's or blocks them.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ago, dollars, wineTitle } from '../lib/format';
import type { CommunityNote, NoteMaturity, NoteReaction } from '../lib/types';
import { useApi } from '../lib/useApi';
import { confirm } from './EntryRows';
import { ChatIcon, HeartIcon, MoreIcon } from './icons';
import { WineThumb } from './WineThumb';
import { Card, Muted, radius, space, type, useTheme, wineStyleOf } from './ui';

export const REACTION_LABEL: Record<NoteReaction, string> = { loved: 'Loved it', liked: 'Liked it', okay: 'It was okay', not_for_me: 'Not for me' };
export const MATURITY_LABEL: Record<NoteMaturity, string> = { too_young: 'Too young', ready: 'Ready to drink', peak: 'At its peak', past_prime: 'Past its prime' };

export function NoteCard({ note, onChanged, open }: { note: CommunityNote; onChanged?: () => void; open?: boolean }) {
  const api = useApi();
  const { c } = useTheme();
  const [liked, setLiked] = useState(note.liked);
  const [likes, setLikes] = useState(note.likes);
  const ws = wineStyleOf(note.wine.colour, note.wine.wineType);
  const name = `${note.vintage && note.vintage !== 'NV' ? `${note.vintage} ` : ''}${wineTitle(note.wine.displayName)}`;
  const maturityTone = note.maturity === 'past_prime' ? c.negative : note.maturity === 'too_young' ? c.caution : c.positive;

  async function like() {
    const next = !liked;
    setLiked(next);
    setLikes(likes + (next ? 1 : -1));
    await api.likeNote(note.noteId, next).catch(() => {
      setLiked(!next);
      setLikes(likes);
    });
  }

  function more() {
    const mine = note.author.me;
    const run: Record<string, () => Promise<void>> = {
      Edit: async () => void router.push(`/share-note?note=${note.noteId}`),
      Delete: async () => {
        if (!(await confirm('Delete this note?', 'It comes down for everyone. Your tasting stays in your Journal.', 'Delete'))) return;
        await api.deleteNote(note.noteId);
        onChanged?.();
      },
      Report: async () => {
        await api.reportNote(note.noteId);
        Alert.alert('Reported', 'Thanks. Notes several people report are hidden until looked at.');
        onChanged?.();
      },
      [`Block ${note.author.name}`]: async () => {
        if (!(await confirm(`Block ${note.author.name}?`, "You won't see their notes or replies. Settings can undo it.", 'Block'))) return;
        await api.blockNoteAuthor(note.noteId);
        onChanged?.();
      },
    };
    const actions = mine ? ['Edit', 'Delete'] : ['Report', `Block ${note.author.name}`];
    const go = (a: string) => void run[a]!().catch(() => Alert.alert("Couldn't do that", 'Try again in a moment.'));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...actions, 'Cancel'], cancelButtonIndex: actions.length, destructiveButtonIndex: 1 }, (i) => {
        if (i < actions.length) go(actions[i]!);
      });
    } else {
      Alert.alert(mine ? 'Your note' : note.author.name, undefined, [
        ...actions.map((a, i) => ({ text: a, style: i === 1 ? ('destructive' as const) : ('default' as const), onPress: () => go(a) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[type.headline, { color: c.onAccentSoft }]}>{note.author.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.headline, { color: c.ink }]} numberOfLines={1}>{note.author.me ? `${note.author.name} (you)` : note.author.name}</Text>
          <Muted>{`${note.author.notes} ${note.author.notes === 1 ? 'note' : 'notes'}`}</Muted>
        </View>
        <Muted>{`${ago(note.createdAt)}${note.edited ? ' · edited' : ''}`}</Muted>
        <Pressable accessibilityRole="button" accessibilityLabel={note.author.me ? 'Edit or delete your note' : 'Report or block'} hitSlop={10} onPress={more} style={{ padding: 4 }}>
          <MoreIcon color={c.ink2} size={20} />
        </Pressable>
      </View>

      {note.hidden ? <Muted style={{ color: c.caution }}>Hidden from others after reports. Edit or delete it.</Muted> : null}

      <Pressable accessibilityRole="button" accessibilityLabel={`${name}, open the wine`} onPress={() => router.push(`/wine/${note.wine.wineId}`)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3] }, pressed && { opacity: 0.8 }]}>
        <WineThumb uri={note.wine.imageUrl} wineStyle={ws} width={40} height={54} />
        <View style={{ flex: 1 }}>
          <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{name}</Text>
          <Muted numberOfLines={1}>{[note.wine.medianCents ? dollars(note.wine.medianCents) : '', note.wine.region, note.wine.country].filter(Boolean).join(' · ')}</Muted>
        </View>
      </Pressable>

      <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, paddingVertical: space[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Muted>Reaction</Muted>
          <Text style={[type.headline, { color: c.ink }]}>{REACTION_LABEL[note.reaction]}</Text>
        </View>
        {note.maturity ? (
          <View style={{ flex: 1, gap: 2, paddingLeft: space[3], borderLeftWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }}>
            <Muted>Maturity</Muted>
            <Text style={[type.headline, { color: maturityTone }]}>{MATURITY_LABEL[note.maturity]}</Text>
          </View>
        ) : null}
      </View>

      {note.body ? <Text style={[type.body, { color: c.ink2 }]} numberOfLines={open ? undefined : 6}>{note.body}</Text> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: liked }} accessibilityLabel={`${liked ? 'Unlike' : 'Like'}, ${likes} ${likes === 1 ? 'like' : 'likes'}`}
          onPress={() => void like()} style={({ pressed }) => [pill(c.hairline), pressed && { opacity: 0.7 }]}>
          <HeartIcon color={liked ? c.accent : c.ink2} size={18} filled={liked} />
          <Text style={[type.subhead, type.tabular, { color: c.ink }]}>{likes}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${note.replies} ${note.replies === 1 ? 'reply' : 'replies'}${open ? '' : ', open'}`} disabled={open}
          onPress={() => router.push(`/community?note=${note.noteId}`)} style={({ pressed }) => [pill(c.hairline), pressed && { opacity: 0.7 }]}>
          <ChatIcon color={c.ink2} size={18} />
          <Text style={[type.subhead, type.tabular, { color: c.ink }]}>{note.replies}</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const pill = (border: string) => ({
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minHeight: 36, paddingHorizontal: space[3],
  borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: border,
});
