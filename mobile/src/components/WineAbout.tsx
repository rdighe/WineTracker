/**
 * "About this wine": researched tasting notes, producer history and specs
 * (GET /api/wines/:id/info). The tasting notes are corroborated against what
 * the wine's spec sheet, critics and shops say, each shown with its source.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { InfoResponse, WineInfo } from '../lib/types';
import { useApi } from '../lib/useApi';
import { Skeleton, TextBones } from './Skeleton';
import { Button, Card, Chip, Heading, Label, Muted, space, type, useTheme } from './ui';

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
      <Label>{title}</Label>
      {children}
    </View>
  );
}

function Body({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text style={[type.subhead, { lineHeight: 22, color: c.ink }]}>{children}</Text>;
}

function Link({ children, url }: { children: ReactNode; url: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)} hitSlop={4}>
      <Text style={[type.subhead, { color: c.accent }]} numberOfLines={1}>{children}</Text>
    </Pressable>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  const { c } = useTheme();
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {shown.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: 12 }}>
          <Text style={[type.footnote, { width: 96, fontWeight: '600', color: c.ink2 }]}>{k}</Text>
          <Text style={[type.subhead, { flex: 1, color: c.ink }]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const KIND_LABEL = { producer: 'Producer', importer: 'Importer', critic: 'Critic', retailer: 'Shop', other: 'Source' } as const;

/** "Agreed by 3 sources", where they differ, and - on request - what each one says. */
function Corroboration({ sources, consensus }: { sources: NonNullable<WineInfo['tastingSources']>; consensus: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  if (!sources.length && !consensus) return null;
  return (
    <View style={{ gap: 8, marginTop: 4, padding: space[3], borderRadius: 10, backgroundColor: c.surfaceSunken }}>
      {sources.length ? (
        <Text style={[type.footnote, { fontWeight: '600', color: c.positive }]}>
          {sources.length === 1 ? 'Checked against 1 source' : `Checked against ${sources.length} sources`}
        </Text>
      ) : null}
      {consensus ? <Text style={[type.subhead, { color: c.ink }]}>{consensus}</Text> : null}
      {sources.length ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} hitSlop={6}>
          <Text style={[type.footnote, { fontWeight: '600', color: c.accent }]}>{open ? 'Hide what each source says' : 'What each source says'}</Text>
        </Pressable>
      ) : null}
      {open
        ? sources.map((s, n) => (
          <View key={`${s.source}-${n}`} style={{ gap: 2 }}>
            <Text style={[type.footnote, { fontWeight: '600', color: c.ink2 }]}>{KIND_LABEL[s.kind]} · {s.source}</Text>
            <Text style={[type.subhead, { color: c.ink }]}>“{s.notes}”</Text>
            {s.url ? <Link url={s.url}>{s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Link> : null}
          </View>
        ))
        : null}
    </View>
  );
}

export function WineAbout({ res }: { res: InfoResponse | null }) {
  const [more, setMore] = useState(false);
  if (res && (res.status === 'unavailable' || res.status === 'none')) return null;
  // Still asking, or the research is under way (and nothing known yet): the card's shape with placeholder lines.
  if (!res || (res.status === 'pending' && !res.info)) {
    return (
      <Card style={{ gap: 14 }}>
        <Heading>About this wine</Heading>
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
        {res ? <Muted>Looking up tasting notes, the producer and the wine&apos;s specs…</Muted> : null}
      </Card>
    );
  }
  if (!res.info) {
    return (
      <Card>
        <Heading>About this wine</Heading>
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
  const sources = i.tastingSources ?? [];
  const sheets = i.specSheets ?? [];
  const hasMore = [i.producer.history, i.vineyard, ...specs.map(([, v]) => v), ...serving.map(([, v]) => v), ...i.foodPairings].some(Boolean);

  return (
    <Card style={{ gap: space[4] }}>
      <Heading>About this wine</Heading>
      {i.summary ? <Body>{i.summary}</Body> : null}
      {notes.some(([, v]) => v) ? (
        <Section title="Tasting notes">
          <Facts rows={notes} />
          <Corroboration sources={sources} consensus={i.consensus ?? ''} />
        </Section>
      ) : null}
      {sheets.length ? (
        <Section title={sheets.length === 1 ? 'Spec sheet' : 'Spec sheets'}>
          {sheets.map((s) => <Link key={s.url} url={s.url}>{s.title} ↗</Link>)}
        </Section>
      ) : null}
      {res.refreshing ? <Muted>Checking spec sheets and other sources…</Muted> : null}
      {i.descriptors.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {i.descriptors.map((d) => <Chip key={d} small>{d}</Chip>)}
        </View>
      ) : null}
      {more ? (
        <>
          {i.producer.history || producer.some(([, v]) => v) ? (
            <Section title="The producer">
              {i.producer.history ? <Body>{i.producer.history}</Body> : null}
              <Facts rows={producer} />
              {i.producer.website ? (
                <Link url={i.producer.website}>{i.producer.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Link>
              ) : null}
            </Section>
          ) : null}
          {i.vineyard ? (
            <Section title="Vineyards">
              <Body>{i.vineyard}</Body>
            </Section>
          ) : null}
          {specs.some(([, v]) => v) ? (
            <Section title="Specs">
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
                <Link key={s.url} url={s.url}>{s.title}</Link>
              ))}
            </Section>
          ) : null}
        </>
      ) : null}
      {hasMore ? <Button title={more ? 'Show less' : 'Producer, vineyards & specs'} variant="secondary" size="sm" onPress={() => setMore(!more)} /> : null}
      <Muted style={{ fontSize: 12 }}>
        {i.grounded ? 'Researched by AI from the web pages listed.' : "From the AI's general knowledge, not checked against the web: it can be wrong."}
      </Muted>
    </Card>
  );
}
