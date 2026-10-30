/**
 * Share with the community: how you liked a wine and whether it was ready,
 * in words, and a note. Your tasting's stars stay private. ?tasting= shares
 * one of your tastings (its notes to start from); ?note= edits a shared
 * note; ?wine= (and ?vintage=) writes one without a tasting.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { confirm } from '../components/EntryRows';
import { MATURITY_LABEL, REACTION_LABEL } from '../components/NoteCard';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button, Card, Chip, ErrorText, Field, Label, Muted, Screen, space, type, useStyles, useTheme } from '../components/ui';
import { wineTitle } from '../lib/format';
import type { NoteMaturity, NoteReaction } from '../lib/types';
import { useApi } from '../lib/useApi';

const reactionFor = (rating: number | null | undefined): NoteReaction =>
  rating == null ? 'liked' : rating >= 4.5 ? 'loved' : rating >= 3.5 ? 'liked' : rating >= 2.5 ? 'okay' : 'not_for_me';

export default function ShareNote() {
  const api = useApi();
  const { c, scheme } = useTheme();
  const s = useStyles();
  const params = useLocalSearchParams<{ tasting?: string; note?: string; wine?: string; vintage?: string }>();
  const [wine, setWine] = useState<{ wineId: number; name: string; vintage: string | null } | null>(null);
  const [noteId, setNoteId] = useState<number | null>(params.note ? Number(params.note) : null);
  const [reaction, setReaction] = useState<NoteReaction>('liked');
  const [maturity, setMaturity] = useState<NoteMaturity | null>(null);
  const [body, setBody] = useState('');
  const [shownAs, setShownAs] = useState('');
  // No name yet (only the stand-in): ask for one here, before it goes out under "A WineTracker member".
  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await api.me();
      if (!cancelled) {
        setShownAs(me.shown_as);
        setNeedsName(!me.public_name && me.shown_as === 'A WineTracker member');
      }
      if (params.note) {
        const { note } = await api.communityNote(Number(params.note));
        if (cancelled) return;
        setWine({ wineId: note.wine.wineId, name: note.wine.displayName, vintage: note.vintage });
        setReaction(note.reaction);
        setMaturity(note.maturity);
        setBody(note.body);
      } else if (params.tasting) {
        const t = (await api.tastings()).tastings.find((x) => x.tasting_id === Number(params.tasting));
        if (!t || cancelled) return;
        setWine({ wineId: t.wine_id, name: t.display_name, vintage: t.vintage_key });
        setReaction(reactionFor(t.rating));
        setBody(t.notes ?? '');
        if (t.note_id) {
          // Shared before: edit that note.
          const { note } = await api.communityNote(t.note_id);
          if (cancelled) return;
          setNoteId(note.noteId);
          setReaction(note.reaction);
          setMaturity(note.maturity);
          setBody(note.body);
        }
      } else if (params.wine) {
        const w = await api.wine(Number(params.wine));
        if (!cancelled) setWine({ wineId: w.wine.wine_id, name: w.wine.display_name, vintage: params.vintage || null });
      }
    })().catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [api, params.note, params.tasting, params.wine, params.vintage]);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      if (needsName && name.trim()) await api.setPublicName(name.trim());
      if (noteId) await api.updateNote(noteId, { reaction, maturity, body });
      else if (params.tasting) await api.shareNote({ tastingId: Number(params.tasting), reaction, maturity, body });
      else await api.shareNote({ wineId: wine!.wineId, vintage: wine!.vintage, reaction, maturity, body });
      router.back();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title={noteId ? 'Your shared note' : 'Share with the community'} subtitle={wine ? `${wine.vintage && wine.vintage !== 'NV' ? `${wine.vintage} ` : ''}${wineTitle(wine.name)}` : ' '} />
      {!wine && !error ? <ActivityIndicator color={c.ink3} /> : null}
      {wine ? (
        <>
          <Card style={{ gap: space[4] }}>
            <View style={{ gap: space[2] }}>
              <Label>How did you like it?</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(Object.keys(REACTION_LABEL) as NoteReaction[]).map((k) => <Chip key={k} selected={reaction === k} onPress={() => setReaction(k)}>{REACTION_LABEL[k]}</Chip>)}
              </View>
            </View>
            <View style={{ gap: space[2] }}>
              <Label>Was it ready to drink? (optional)</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(Object.keys(MATURITY_LABEL) as NoteMaturity[]).map((k) => <Chip key={k} selected={maturity === k} onPress={() => setMaturity(maturity === k ? null : k)}>{MATURITY_LABEL[k]}</Chip>)}
              </View>
            </View>
            <View style={{ gap: space[2] }}>
              <Label>Your note</Label>
              <TextInput
                accessibilityLabel="Your note"
                value={body}
                onChangeText={setBody}
                placeholder="What it tasted like, what you had it with, whether it's worth the price…"
                placeholderTextColor={c.ink3}
                keyboardAppearance={scheme}
                multiline
                maxLength={1500}
                style={[s.input, { minHeight: 120, paddingTop: 12, textAlignVertical: 'top', color: c.ink }]}
              />
            </View>
          </Card>
          {needsName ? (
            <Card style={{ gap: space[2] }}>
              <Field label="Your name to show" value={name} onChangeText={setName} placeholder="First name and initial, or a handle" maxLength={40} />
              <Muted>Shown with your notes instead of &quot;A WineTracker member&quot;. Never your email.</Muted>
            </Card>
          ) : null}
          <Muted>
            {`Everyone on WineTracker can read this, shown as "${needsName && name.trim() ? name.trim() : shownAs || '…'}". Your star rating stays private. Change the name in Settings.`}
          </Muted>
          <ErrorText error={error} />
          <Button title={noteId ? 'Update note' : 'Share'} busy={busy} onPress={() => void post()} />
          {noteId ? (
            <Button title="Stop sharing" variant="plain" size="sm" onPress={async () => {
              if (!(await confirm('Stop sharing this note?', 'It comes down for everyone. Your tasting stays in your Journal.', 'Stop sharing'))) return;
              await api.deleteNote(noteId).then(() => router.back(), setError);
            }} />
          ) : null}
          <Text style={[type.footnote, { color: c.ink3 }]}>Be kind and stick to the wine. Notes several people report are hidden.</Text>
        </>
      ) : null}
      <ErrorText error={!wine ? error : null} />
    </Screen>
  );
}
