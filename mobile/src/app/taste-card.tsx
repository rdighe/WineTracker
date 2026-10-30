/**
 * Someone's taste card: opened from their shared link (?code=, from
 * winetracker://taste-card?code=…) or from your friends (?friend=). How alike
 * your tastes are, the flavors you share, wines you both loved and what they
 * love that you haven't tried; add them as a friend, or remove them.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { confirm } from '../components/EntryRows';
import { FlavorCardView } from '../components/FlavorCardView';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button, Card, ErrorText, Label, Muted, Screen, space, type, useTheme } from '../components/ui';
import { wineTitle } from '../lib/format';
import type { SharedTaste } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function TasteCardScreen() {
  const api = useApi();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ code?: string; friend?: string }>();
  const [data, setData] = useState<SharedTaste | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const p = params.friend ? api.tasteFriend(Number(params.friend)) : api.tasteCardByCode(params.code ?? '');
    p.then((d) => {
      setData(d);
      setError(null);
    }, setError);
  }, [api, params.friend, params.code]);
  useEffect(() => load(), [load]);

  async function add() {
    setBusy(true);
    try {
      await api.addTasteFriend(params.code ?? '');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const cmp = data?.comparison;
  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title={data ? (data.me ? 'Your taste card' : `${data.card.name}'s taste`) : 'Taste card'} subtitle={data?.me ? 'This is what friends see.' : undefined} />
      <ErrorText error={error} />
      {!data && !error ? <ActivityIndicator color={c.ink3} /> : null}
      {cmp ? (
        <Card style={{ gap: space[3] }}>
          {cmp.similarity === null ? (
            <Muted>Too early to compare: you each need a few rated wines. Once you have, this shows how alike your tastes are.</Muted>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
                <Text style={[type.figureHero, { color: c.accent }]}>{`${cmp.similarity}%`}</Text>
                <Text style={[type.headline, { color: c.ink }]}>alike</Text>
              </View>
              {cmp.shared.length ? <Muted>{`You both lean to ${cmp.shared.join(', ')}.`}</Muted> : <Muted>Your tastes go different ways, which makes for good swaps.</Muted>}
            </>
          )}
          {cmp.bothLoved.length ? (
            <View style={{ gap: space[1] }}>
              <Label>You both loved</Label>
              {cmp.bothLoved.map((w) => <WineLink key={w.wineId} id={w.wineId} name={wineTitle(w.name)} />)}
            </View>
          ) : null}
          {cmp.theyLoveYouHavent.length ? (
            <View style={{ gap: space[1] }}>
              <Label>{`${data!.card.name} loves, you haven't tried`}</Label>
              {cmp.theyLoveYouHavent.map((w) => <WineLink key={w.wineId} id={w.wineId} name={`${w.vintage && w.vintage !== 'NV' ? `${w.vintage} ` : ''}${wineTitle(w.name)}`} />)}
            </View>
          ) : null}
        </Card>
      ) : null}
      {data ? <FlavorCardView card={data.card} heading={data.me ? 'Your taste card' : 'Taste card'} /> : null}
      {data && !data.me ? (
        data.friend ? (
          <Button title={`Remove ${data.card.name} from friends`} variant="plain" size="sm" onPress={async () => {
            if (!(await confirm(`Remove ${data.card.name}?`, 'Neither of you will see the other in Friends.', 'Remove'))) return;
            await api.removeTasteFriend(data.userId).then(() => router.back(), setError);
          }} />
        ) : (
          <Button title={`Add ${data.card.name} as a friend`} busy={busy} onPress={() => void add()} />
        )
      ) : null}
      {data && !data.me && !data.friend ? <Muted>Friends see each other&apos;s card and how alike you are, any time, from Your taste.</Muted> : null}
    </Screen>
  );
}

function WineLink({ id, name }: { id: number; name: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/wine/${id}`)}>
      <Text style={[type.subhead, { color: c.accent }]} numberOfLines={1}>{name}</Text>
    </Pressable>
  );
}
