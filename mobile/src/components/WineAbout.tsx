/** "About this wine": researched tasting notes, producer history and specs (GET /api/wines/:id/info). */
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { InfoResponse, WineInfo } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Skeleton, TextBones } from './Skeleton';
import { Button, Card, Chip, Eyebrow, Muted, colors, fonts } from './ui';

const POLL_MS = 4000;
/** Research takes 10-40 s; stop asking after this long. */
const POLL_FOR_MS = 120000;

/** The wine's researched info, re-checked while research is under way. */
export function useWineInfo(wineId: number): InfoResponse | null {
  const api = useApi();
  const [res, setRes] = useState<InfoResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const load = async () => {
      try {
        const r = await api.wineInfo(wineId);
        if (cancelled) return;
        setRes(r);
        if (r.status === 'pending' && Date.now() - started < POLL_FOR_MS) timer = setTimeout(load, POLL_MS);
      } catch {
        // Background info is optional; the rest of the page works without it.
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, wineId]);
  return res;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow style={{ fontSize: 10 }}>{title}</Eyebrow>
      {children}
    </View>
  );
}

const Body = ({ children }: { children: ReactNode }) => (
  <Text style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.text2 }}>{children}</Text>
);

function Facts({ rows }: { rows: [string, string][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {shown.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: 12 }}>
          <Text style={{ width: 96, fontFamily: fonts.medium, fontSize: 12, color: colors.muted }}>{k}</Text>
          <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.text }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export function WineAbout({ res }: { res: InfoResponse | null }) {
  const [more, setMore] = useState(false);
  if (res && (res.status === 'unavailable' || res.status === 'none')) return null;
  // Still asking, or the research is under way: the card's shape with placeholder lines.
  if (!res || res.status === 'pending') {
    return (
      <Card style={{ paddingHorizontal: 20, gap: 14 }}>
        <Eyebrow>About this wine</Eyebrow>
        <Skeleton label="Loading tasting notes and background">
          <TextBones lines={3} height={13} />
          <View style={{ gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ width: 96 }}><TextBones lines={1} height={11} /></View>
                <View style={{ flex: 1 }}><TextBones lines={2} height={11} /></View>
              </View>
            ))}
          </View>
        </Skeleton>
        {res ? <Muted style={{ fontSize: 12 }}>Looking up tasting notes, the producer and the wine&apos;s specs…</Muted> : null}
      </Card>
    );
  }
  if (res.status === 'failed' || !res.info) {
    return (
      <Card>
        <Eyebrow>About this wine</Eyebrow>
        <Muted>Couldn&apos;t find background for this wine. It will try again tomorrow.</Muted>
      </Card>
    );
  }
  const i: WineInfo = res.info;
  const notes: [string, string][] = [['Appearance', i.tastingNotes.appearance], ['Nose', i.tastingNotes.nose], ['Palate', i.tastingNotes.palate], ['Finish', i.tastingNotes.finish]];
  const specs: [string, string][] = [
    ['Grapes', i.specs.grapes], ['Alcohol', i.specs.abv], ['Ageing', i.specs.aging], ['Winemaking', i.specs.vinification],
    ['Soil', i.specs.soil], ['Production', i.specs.production],
  ];
  const serving: [string, string][] = [['Serve at', i.serving.temperature], ['Decanting', i.serving.decant], ['Drinking window', i.serving.drinkingWindow]];
  const producer: [string, string][] = [['Founded', i.producer.founded], ['Where', i.producer.location]];
  const hasMore = [i.producer.history, i.vineyard, ...specs.map(([, v]) => v), ...serving.map(([, v]) => v), ...i.foodPairings].some(Boolean);

  return (
    <Card style={{ paddingHorizontal: 20, gap: 16 }}>
      <Eyebrow>About this wine</Eyebrow>
      {i.summary ? <Body>{i.summary}</Body> : null}
      {notes.some(([, v]) => v) ? (
        <Section title="Tasting notes">
          <Facts rows={notes} />
        </Section>
      ) : null}
      {i.descriptors.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {i.descriptors.map((d) => <Chip key={d} tone="tag">{d}</Chip>)}
        </View>
      ) : null}
      {more ? (
        <>
          {i.producer.history || producer.some(([, v]) => v) ? (
            <Section title="The producer">
              {i.producer.history ? <Body>{i.producer.history}</Body> : null}
              <Facts rows={producer} />
              {i.producer.website ? (
                <Pressable accessibilityRole="link" onPress={() => Linking.openURL(i.producer.website)}>
                  <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: colors.accent }}>{i.producer.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Text>
                </Pressable>
              ) : null}
            </Section>
          ) : null}
          {i.vineyard ? (
            <Section title="Vineyards">
              <Body>{i.vineyard}</Body>
            </Section>
          ) : null}
          {specs.some(([, v]) => v) ? (
            <Section title="Spec sheet">
              <Facts rows={specs} />
            </Section>
          ) : null}
          {serving.some(([, v]) => v) || i.foodPairings.length ? (
            <Section title="Serving">
              <Facts rows={[...serving, ['Food', i.foodPairings.join(', ')]]} />
            </Section>
          ) : null}
          {i.sources.length ? (
            <Section title="Sources">
              {i.sources.map((s) => (
                <Pressable key={s.url} accessibilityRole="link" onPress={() => Linking.openURL(s.url)}>
                  <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: colors.accent }} numberOfLines={1}>{s.title}</Text>
                </Pressable>
              ))}
            </Section>
          ) : null}
        </>
      ) : null}
      {hasMore ? <Button title={more ? 'Show less' : 'Producer, vineyards & spec sheet'} variant="pill" style={{ borderColor: colors.line2 }} onPress={() => setMore(!more)} /> : null}
      <Muted style={{ fontSize: 11 }}>
        {i.grounded ? 'Researched by AI from the web pages listed.' : "From the AI's general knowledge, not checked against the web: it can be wrong."}
      </Muted>
    </Card>
  );
}
