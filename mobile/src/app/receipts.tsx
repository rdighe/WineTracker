/**
 * Receipts and invoices (from Cellar › Receipts, or + › Receipt or invoice):
 * photograph a receipt or upload an invoice PDF; the phone reads its text
 * (lib/wineList.ts) and the server reads that into wines, each matched with
 * how many bottles and the price of one (src/cellars/receipts.ts). Check the
 * lines, then the bottles go into a cellar at what they cost, with the
 * receipt kept. Earlier receipts are listed; ?id= opens one. ?new=1 (from +)
 * opens with the ways to add one first.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { DateField } from '../components/DateField';
import { Badge, confirm } from '../components/EntryRows';
import { ChevronIcon, DocumentIcon, PhotosIcon, ScanIcon } from '../components/icons';
import { ReceiptPhoto } from '../components/PickPhoto';
import { ScreenHeader } from '../components/ScreenHeader';
import { WineThumb } from '../components/WineThumb';
import { Button, Card, Chip, Divider, ErrorText, Field, Label, Muted, Screen, radius, space, type, useTheme, wineStyleOf } from '../components/ui';
import { dollars, shortDate, todayIso, wineTitle } from '../lib/format';
import { newScanRef, scanAnswer } from '../lib/pendingScan';
import { prepareLabelPhoto } from '../lib/photo';
import type { Cellar, Receipt, ReceiptDetail, ReceiptLine, ReceiptRead } from '../lib/types';
import { useApi } from '../lib/useApi';
import { readListPdf, readListPhoto } from '../lib/wineList';

/** A kept receipt photo: enough to read it again. */
const PHOTO_SIDE = 1600;
/** Invoice pages read from a PDF. */
const MAX_PDF_PAGES = 4;

interface DraftLine extends ReceiptLine { include: boolean; vintageText: string; priceText: string }
interface Draft { merchant: string; purchasedOn: string; totalText: string; lines: DraftLine[] }

const centsText = (cents: number | null) => (cents ? (cents / 100).toFixed(2) : '');
const toCents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export default function Receipts() {
  const api = useApi();
  const params = useLocalSearchParams<{ id?: string; new?: string }>();
  if (params.id) return <ReceiptView id={Number(params.id)} />;
  return <ReceiptsHome api={api} fresh={params.new === '1'} />;
}

function ReceiptsHome({ api, fresh }: { api: ReturnType<typeof useApi>; fresh: boolean }) {
  const { c } = useTheme();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [cellars, setCellars] = useState<Cellar[]>([]);
  const [cellarId, setCellarId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [photo, setPhoto] = useState<{ base64: string; mimeType: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, cs] = await Promise.all([api.receipts(), api.cellars()]);
      setReceipts(r.receipts);
      const mine = cs.cellars.filter((x) => x.role !== 'viewer');
      setCellars(mine);
      setCellarId((cur) => cur ?? mine[0]?.cellarId ?? null);
    } catch (e) {
      setError(e);
    }
  }, [api]);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function read(input: { pages?: string[]; imageBase64?: string; mimeType?: string }) {
    const ref = newScanRef();
    await api.readReceipt(input, ref);
    const r = await scanAnswer<ReceiptRead>(api, ref, { tooLong: 'Reading the receipt is taking too long. Try again.' });
    setDraft({
      merchant: r.merchant,
      purchasedOn: r.purchasedOn ?? todayIso(),
      totalText: centsText(r.totalCents),
      lines: r.lines.map((l) => ({ ...l, include: true, vintageText: l.vintage, priceText: centsText(l.unitCents) })),
    });
  }

  async function fromPhoto(fromCamera: boolean) {
    setError(null);
    setDone(null);
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return void Alert.alert('Permission needed', fromCamera ? 'Allow camera access to photograph the receipt.' : 'Allow photo access to choose it.');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    try {
      setStatus('Reading the receipt…');
      const rows = await readListPhoto(asset.uri);
      const kept = await prepareLabelPhoto(asset, PHOTO_SIDE);
      setPhoto({ base64: kept.base64, mimeType: kept.mimeType });
      // The text the phone read; where it can't read text (the web), the photo itself.
      await read(rows?.length ? { pages: [rows.join('\n')] } : { imageBase64: kept.base64, mimeType: kept.mimeType });
    } catch (e) {
      setError(e);
    } finally {
      setStatus(null);
    }
  }

  async function fromPdf() {
    setError(null);
    setDone(null);
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    try {
      setStatus('Reading the invoice…');
      const pdf = await readListPdf(res.assets[0].uri, MAX_PDF_PAGES).catch(() => {
        throw new Error("Couldn't open that PDF. Try a photo of the invoice instead.");
      });
      if (!pdf) throw new Error('PDF invoices can be read in the iPhone app. Try a photo instead.');
      if (!pdf.pages.length) throw new Error('No text found in that PDF. Try a photo of the invoice instead.');
      const first = await prepareLabelPhoto(pdf.pages[0]!, PHOTO_SIDE);
      setPhoto({ base64: first.base64, mimeType: first.mimeType });
      await read({ pages: pdf.pages.map((p) => p.text) });
    } catch (e) {
      setError(e);
    } finally {
      setStatus(null);
    }
  }

  async function save() {
    if (!draft) return;
    const lines = draft.lines.filter((l) => l.include);
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveReceipt({
        cellarId, merchant: draft.merchant.trim(), purchasedOn: draft.purchasedOn || null, totalCents: toCents(draft.totalText), photo,
        lines: lines.map((l) => ({
          wineId: l.wineId, producer: l.wineId ? undefined : l.producer, name: l.wineId ? undefined : l.name,
          vintage: /^(1[89]\d\d|20\d\d|NV)$/.test(l.vintageText.trim()) ? l.vintageText.trim() : null,
          qty: Math.max(1, l.qty), unitCents: toCents(l.priceText), bottleMl: l.bottleMl,
        })),
      });
      const n = lines.reduce((s, l) => s + l.qty, 0);
      const where = cellars.find((x) => x.cellarId === r.cellarId)?.name ?? 'your cellar';
      setDone(`${n} ${n === 1 ? 'bottle' : 'bottles'} added to ${where}.`);
      setDraft(null);
      setPhoto(null);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const setLine = (i: number, patch: Partial<DraftLine>) => setDraft((d) => (d ? { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : d));

  if (draft) {
    const lines = draft.lines.filter((l) => l.include);
    const bottles = lines.reduce((s, l) => s + l.qty, 0);
    const spent = lines.reduce((s, l) => s + (toCents(l.priceText) ?? 0) * l.qty, 0);
    return (
      <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
        <ScreenHeader title="Check the receipt" subtitle="Fix anything misread; skip what isn't wine for your cellar" />
        <Card style={{ gap: space[3] }}>
          <Field label="Shop" value={draft.merchant} onChangeText={(merchant) => setDraft({ ...draft, merchant })} placeholder="Where you bought them" />
          <DateField label="Bought on" value={draft.purchasedOn} onChange={(purchasedOn) => setDraft({ ...draft, purchasedOn })} />
          <Field label="Receipt total ($)" numeric keyboardType="decimal-pad" value={draft.totalText} onChangeText={(totalText) => setDraft({ ...draft, totalText })} />
          {cellars.length > 1 ? (
            <View style={{ gap: space[2] }}>
              <Label>Into</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {cellars.map((x) => <Chip key={x.cellarId} small selected={cellarId === x.cellarId} onPress={() => setCellarId(x.cellarId)}>{x.name}</Chip>)}
              </View>
            </View>
          ) : null}
        </Card>

        <View style={{ gap: space[2] }}>
          <Label>{`${draft.lines.length} ${draft.lines.length === 1 ? 'wine' : 'wines'} on it`}</Label>
          {draft.lines.map((l, i) => <LineCard key={l.index} l={l} onChange={(p) => setLine(i, p)} />)}
        </View>

        <ErrorText error={error} />
        <View style={{ gap: space[2] }}>
          <Muted>{`${bottles} ${bottles === 1 ? 'bottle' : 'bottles'}${spent ? ` · ${dollars(spent)}` : ''}`}</Muted>
          <Button title={bottles ? `Add ${bottles} ${bottles === 1 ? 'bottle' : 'bottles'} to the cellar` : 'Nothing to add'} busy={saving} disabled={!bottles} onPress={() => void save()} />
          <Button title="Start over" variant="plain" size="sm" onPress={() => { setDraft(null); setPhoto(null); }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title="Receipts" subtitle="What you paid, kept with the bottles it bought" />
      <Card style={{ gap: space[3] }}>
        <Text style={[type.headline, { color: c.ink }]}>{fresh ? 'Add a receipt or invoice' : 'Add one'}</Text>
        <Muted>Every wine on it is matched, with how many bottles and the price of one. You check, then they go into your cellar.</Muted>
        {status ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] }}>
            <ActivityIndicator color={c.ink3} />
            <Muted>{status}</Muted>
          </View>
        ) : (
          <View style={{ gap: space[2] }}>
            <Button title="Photograph a receipt" icon={(fg) => <ScanIcon color={fg} size={20} />} onPress={() => void fromPhoto(true)} />
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button title="A photo" variant="secondary" size="md" style={{ flex: 1 }} icon={(fg) => <PhotosIcon color={fg} size={18} />} onPress={() => void fromPhoto(false)} />
              <Button title="A PDF" variant="secondary" size="md" style={{ flex: 1 }} icon={(fg) => <DocumentIcon color={fg} size={18} />} onPress={() => void fromPdf()} />
            </View>
          </View>
        )}
        {done ? <Text style={[type.subhead, { color: c.positive }]} accessibilityLiveRegion="polite">{done}</Text> : null}
      </Card>
      <ErrorText error={error} />
      {receipts?.length ? (
        <View style={{ gap: space[2] }}>
          <Label>Filed</Label>
          <Card flush>
            {receipts.map((r, i) => (
              <View key={r.receiptId}>
                {i ? <Divider style={{ marginLeft: space[4] + 44 + space[3] }} /> : null}
                <ReceiptRow r={r} showCellar={cellars.length > 1} />
              </View>
            ))}
          </Card>
        </View>
      ) : receipts ? <Muted style={type.subhead}>Receipts you add are kept here, with their photos.</Muted> : null}
    </Screen>
  );
}

function LineCard({ l, onChange }: { l: DraftLine; onChange: (p: Partial<DraftLine>) => void }) {
  const { c } = useTheme();
  const name = l.wineId ? wineTitle(l.displayName, l.region) : [l.producer, l.name].filter(Boolean).join(' ') || l.text;
  const unit = toCents(l.priceText);
  const vsMarket = unit && l.retailCents ? (unit - l.retailCents) / l.retailCents : null;
  return (
    <Card style={{ gap: space[3], opacity: l.include ? 1 : 0.55 }}>
      <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
        <WineThumb uri={l.imageUrl} wineStyle={wineStyleOf(l.style === 'sweet' ? 'white' : l.style, l.style)} width={36} height={50} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.wineTitle, { color: c.ink }]} numberOfLines={2}>{name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {!l.wineId ? <Badge>New to WineTracker</Badge> : l.match !== 'matched' ? <Badge>Best guess</Badge> : null}
            {vsMarket !== null && Math.abs(vsMarket) >= 0.05 ? (
              <Text style={[type.footnote, { color: vsMarket < 0 ? c.positive : c.ink3 }]}>
                {vsMarket < 0 ? `${Math.round(-vsMarket * 100)}% under the market` : `${Math.round(vsMarket * 100)}% over the market`}
              </Text>
            ) : null}
          </View>
        </View>
        <Chip small selected={l.include} onPress={() => onChange({ include: !l.include })}>{l.include ? 'Adding' : 'Skipped'}</Chip>
      </View>
      {l.include ? (
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-end' }}>
          <View style={{ width: 84 }}><Field label="Vintage" numeric value={l.vintageText} onChangeText={(vintageText) => onChange({ vintageText })} placeholder="NV" maxLength={4} /></View>
          <View style={{ flex: 1 }}><Field label="Each ($)" numeric keyboardType="decimal-pad" value={l.priceText} onChangeText={(priceText) => onChange({ priceText })} /></View>
          <Stepper value={l.qty} onChange={(qty) => onChange({ qty })} />
        </View>
      ) : null}
      {l.text ? <Text style={[type.footnote, { color: c.ink3 }]} numberOfLines={1}>{`On the receipt: ${l.text}`}</Text> : null}
    </Card>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { c } = useTheme();
  const btn = (label: string, d: number) => (
    <Pressable accessibilityRole="button" accessibilityLabel={d < 0 ? 'One fewer bottle' : 'One more bottle'} disabled={value + d < 1} hitSlop={6}
      onPress={() => onChange(Math.max(1, value + d))}
      style={({ pressed }) => [{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
      <Text style={[type.title3, { color: value + d < 1 ? c.ink3 : c.accent }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      <Label>Bottles</Label>
      <View accessibilityLabel={`${value} bottles`} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
        {btn('−', -1)}
        <Text style={[type.figure, { color: c.ink, minWidth: 24, textAlign: 'center' }]}>{value}</Text>
        {btn('+', 1)}
      </View>
    </View>
  );
}

function ReceiptRow({ r, showCellar }: { r: Receipt; showCellar: boolean }) {
  const { c } = useTheme();
  const title = r.merchant || 'Receipt';
  const detail = [shortDate(r.purchasedOn), `${r.bottles} ${r.bottles === 1 ? 'bottle' : 'bottles'}`, showCellar ? r.cellarName : ''].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}${r.totalCents ? `, ${dollars(r.totalCents)}` : ''}`}
      onPress={() => router.push(`/receipts?id=${r.receiptId}`)}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
    >
      {r.hasPhoto ? (
        <ReceiptPhoto receiptId={r.receiptId} style={{ width: 44, height: 56, borderRadius: radius.sm }} />
      ) : (
        <View style={{ width: 44, height: 56, borderRadius: radius.sm, backgroundColor: c.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <DocumentIcon color={c.ink3} size={22} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.headline, { color: c.ink }]} numberOfLines={1}>{title}</Text>
        <Muted numberOfLines={1}>{detail}</Muted>
      </View>
      {r.totalCents ? <Text style={[type.figure, { color: c.ink }]}>{dollars(r.totalCents)}</Text> : null}
      <ChevronIcon color={c.ink3} />
    </Pressable>
  );
}

function ReceiptView({ id }: { id: number }) {
  const api = useApi();
  const { c } = useTheme();
  const [r, setR] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    api.receipt(id).then((x) => !cancelled && setR(x), (e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title={r?.merchant || 'Receipt'} subtitle={r ? [shortDate(r.purchasedOn), r.cellarName, r.totalCents ? dollars(r.totalCents) : ''].filter(Boolean).join(' · ') : ' '} />
      <ErrorText error={error} />
      {r?.hasPhoto ? <ReceiptPhoto receiptId={id} fit="contain" style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md }} /> : null}
      {r ? (
        <View style={{ gap: space[2] }}>
          <Label>Bottles it added</Label>
          <Card flush>
            {r.entries.map((e, i) => (
              <View key={e.tasting_id}>
                {i ? <Divider style={{ marginLeft: space[4] + 32 + space[3] }} /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/wine/${e.wine_id}`)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
                >
                  <WineThumb uri={e.image_url} wineStyle={wineStyleOf(e.colour, e.wine_type)} width={32} height={44} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.subhead, { color: c.ink, fontWeight: '600' }]} numberOfLines={1}>{e.display_name}</Text>
                    <Muted>{[e.vintage_key ?? 'NV', e.kind === 'cellar' ? `${e.bottles ?? 1} in the cellar` : 'Drunk since'].join(' · ')}</Muted>
                  </View>
                  {e.price_paid_cents ? <Text style={[type.figure, { color: c.ink }]}>{dollars(e.price_paid_cents)}</Text> : null}
                </Pressable>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      {r ? (
        <Button title="Forget this receipt" variant="plain" size="sm" onPress={async () => {
          if (!(await confirm('Forget this receipt?', 'The bottles it added stay in your cellar.', 'Forget'))) return;
          try {
            await api.deleteReceipt(id);
            router.back();
          } catch (e) {
            setError(e);
          }
        }} />
      ) : null}
    </Screen>
  );
}
