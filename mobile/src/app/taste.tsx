/**
 * Your taste (Settings, Discover): your taste card, built from your ratings
 * and the taste quiz, and yours to change - flavors you like or don't,
 * styles, a budget to always use, grapes or places to keep away from. Share
 * it by link with friends (app/taste-card.tsx), see how alike you are, and
 * revoke the link whenever.
 */
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import { confirm } from '../components/EntryRows';
import { FlavorCardView } from '../components/FlavorCardView';
import { ChevronIcon, ShareIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button, Card, Chip, Divider, ErrorText, Field, Label, Muted, Screen, space, type, useTheme } from '../components/ui';
import { FLAVOR_LABELS, type Budget, type RecStyle, type TasteCard } from '../lib/types';
import { useApi } from '../lib/useApi';

const STYLES: { key: RecStyle; label: string }[] = [
  { key: 'red', label: 'Red' }, { key: 'white', label: 'White' }, { key: 'rose', label: 'Rosé' }, { key: 'sparkling', label: 'Sparkling' }, { key: 'orange', label: 'Orange' }, { key: 'sweet', label: 'Dessert' },
];
const BUDGETS: { key: Budget; label: string }[] = [{ key: 'under20', label: 'Under $20' }, { key: '20to40', label: '$20–40' }, { key: '40to80', label: '$40–80' }, { key: 'over80', label: '$80+' }];

export default function Taste() {
  const api = useApi();
  const { c } = useTheme();
  const [card, setCard] = useState<TasteCard | null>(null);
  const [friends, setFriends] = useState<{ userId: number; name: string; similarity: number | null }[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [t, f] = await Promise.all([api.taste(), api.tasteFriends()]);
      setCard(t);
      setFriends(f.friends);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function share() {
    try {
      const { code } = await api.tasteLink();
      const url = Linking.createURL('taste-card', { queryParams: { code } });
      await Share.share({ message: `My wine taste on WineTracker: see how alike we are. ${url}` });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title="Your taste" subtitle="What your ratings say you like. Change anything that's off." />
      <ErrorText error={error} />
      {!card ? <ActivityIndicator color={c.ink3} /> : (
        <>
          <FlavorCardView card={card} heading="Your taste card" />
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <Button title={editing ? 'Done' : 'Change it'} variant={editing ? 'primary' : 'secondary'} size="md" style={{ flex: 1 }} onPress={() => setEditing(!editing)} />
            <Button title="Share" variant="tinted" size="md" style={{ flex: 1 }} icon={(fg) => <ShareIcon color={fg} size={18} />} onPress={() => void share()} />
          </View>
          {editing ? <Editor card={card} onSaved={setCard} /> : null}

          <View style={{ gap: space[2] }}>
            <Label>Friends</Label>
            {friends.length ? (
              <Card flush>
                {friends.map((f, i) => (
                  <View key={f.userId}>
                    {i ? <Divider style={{ marginLeft: space[4] }} /> : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={f.similarity === null ? `${f.name}, not enough ratings to compare yet` : `${f.name}, ${f.similarity} percent alike`} onPress={() => router.push(`/taste-card?friend=${f.userId}`)}
                      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={[type.headline, { color: c.onAccentSoft }]}>{f.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <Text style={[type.headline, { flex: 1, color: c.ink }]} numberOfLines={1}>{f.name}</Text>
                      {f.similarity === null ? <Muted>Too early to tell</Muted> : (
                        <>
                          <Text style={[type.figure, { color: c.ink }]}>{`${f.similarity}%`}</Text>
                          <Muted>alike</Muted>
                        </>
                      )}
                      <ChevronIcon color={c.ink3} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            ) : (
              <Muted>Share your card with a friend. When they open it and add you, you both see how alike your tastes are and what the other loves.</Muted>
            )}
          </View>
          <Muted style={{ color: c.ink3 }}>
            Your card shows your name, the flavors, styles, grapes and places you like, your usual price and your favorite bottles. Never your ratings, notes or cellar.
          </Muted>
          <Button title="Stop the old link working" variant="plain" size="sm" onPress={async () => {
            if (!(await confirm('Make a new link?', 'Anyone with the old link can no longer open your card. Friends you already have stay.', 'New link'))) return;
            await api.tasteLink(true).catch(setError);
          }} />
        </>
      )}
    </Screen>
  );
}

/** Flavors: tap once to like, again to dislike, again to leave to your ratings. */
function Editor({ card, onSaved }: { card: TasteCard; onSaved: (c: TasteCard) => void }) {
  const api = useApi();
  const { c } = useTheme();
  const e = card.edits!;
  const [liked, setLiked] = useState(e.likedFlavors);
  const [disliked, setDisliked] = useState(e.dislikedFlavors);
  const [styles, setStyles] = useState<RecStyle[]>(e.styles.length ? e.styles : card.styles);
  const [budget, setBudget] = useState<Budget | null>(e.budget);
  const [budgetFixed, setBudgetFixed] = useState(e.budgetFixed);
  const [avoid, setAvoid] = useState(e.avoid);
  const [avoidText, setAvoidText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const cycle = (k: string) => {
    if (liked.includes(k)) {
      setLiked(liked.filter((x) => x !== k));
      setDisliked([...disliked, k]);
    } else if (disliked.includes(k)) setDisliked(disliked.filter((x) => x !== k));
    else setLiked([...liked, k]);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.editTaste({ likedFlavors: liked, dislikedFlavors: disliked, styles, budget, budgetFixed, avoid }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Label>Flavors</Label>
        <Muted>Tap once if you like it, twice if you don&apos;t, three times to leave it to your ratings.</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(FLAVOR_LABELS).map(([k, label]) => {
            const state = liked.includes(k) ? 'like' : disliked.includes(k) ? 'dislike' : null;
            return (
              <Chip key={k} small selected={state === 'like'} onPress={() => cycle(k)}>
                {state === 'dislike' ? `✕ ${label}` : state === 'like' ? `♥ ${label}` : label}
              </Chip>
            );
          })}
        </View>
      </View>
      <View style={{ gap: space[2] }}>
        <Label>Styles you drink</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {STYLES.map((s) => <Chip key={s.key} small selected={styles.includes(s.key)} onPress={() => setStyles(styles.includes(s.key) ? styles.filter((x) => x !== s.key) : [...styles, s.key])}>{s.label}</Chip>)}
        </View>
      </View>
      <View style={{ gap: space[2] }}>
        <Label>Usual price</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {BUDGETS.map((b) => <Chip key={b.key} small selected={budget === b.key} onPress={() => setBudget(budget === b.key ? null : b.key)}>{b.label}</Chip>)}
        </View>
        {budget ? (
          <Chip small selected={budgetFixed} onPress={() => setBudgetFixed(!budgetFixed)}>{budgetFixed ? 'Always use this price' : 'Use this until my ratings show otherwise'}</Chip>
        ) : null}
      </View>
      <View style={{ gap: space[2] }}>
        <Label>Keep away from</Label>
        <Muted>A grape, region or country you never want suggested.</Muted>
        {avoid.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {avoid.map((a) => <Chip key={a} small selected onPress={() => setAvoid(avoid.filter((x) => x !== a))}>{`${a}  ×`}</Chip>)}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label="Add one" value={avoidText} onChangeText={setAvoidText} placeholder="Chardonnay, Bordeaux…" maxLength={40}
              onSubmitEditing={() => { if (avoidText.trim()) { setAvoid([...avoid, avoidText.trim()]); setAvoidText(''); } }} returnKeyType="done" />
          </View>
          <Button title="Add" variant="secondary" size="md" disabled={!avoidText.trim()} onPress={() => { setAvoid([...avoid, avoidText.trim()]); setAvoidText(''); }} />
        </View>
      </View>
      <ErrorText error={error} />
      <Button title="Save changes" busy={busy} onPress={() => void save()} />
      <Text style={[type.footnote, { color: c.ink3 }]}>Your suggestions, wine-list picks and fit follow these changes straight away.</Text>
    </Card>
  );
}
