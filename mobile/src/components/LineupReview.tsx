/**
 * Review a lineup scan: every bottle read from one photo, each matched to a
 * wine (or offered as a new one), with its vintage and bottle count; then
 * all are added in one go. The same wine and vintage twice becomes one
 * cellar entry with two bottles.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import type { ScanResult } from '../lib/types';
import { useApi } from '../lib/useApi';
import { BackIcon } from './icons';
import { Button, Card, Chip, ErrorText, Eyebrow, IconButton, Muted, Screen, Segmented, colors, fonts } from './ui';

type Kind = 'cellar' | 'tasted';

interface Row {
  scan: ScanResult;
  /** Index into scan.candidates, or -1 for "add as a new wine". */
  pick: number;
  vintage: string;
  bottles: number;
  include: boolean;
}

const readName = (s: ScanResult) => [s.read.producer, s.read.name].filter(Boolean).join(' ');

function initialRow(scan: ScanResult): Row {
  const pick = scan.candidates.length ? 0 : -1;
  return { scan, pick, vintage: scan.vintage ?? '', bottles: 1, include: pick >= 0 || Boolean(readName(scan)) };
}

export function LineupReview({ uri, scans, onDone }: { uri: string; scans: ScanResult[]; onDone: () => void }) {
  const api = useApi();
  const [rows, setRows] = useState<Row[]>(() => scans.map(initialRow));
  const [kind, setKind] = useState<Kind>('cellar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include);

  async function addAll() {
    setBusy(true);
    setError(null);
    const bad = new Set<number>();
    try {
      for (const r of chosen) {
        const v = r.vintage.trim().toUpperCase();
        if (v && !/^(1[89]\d\d|20\d\d|NV)$/.test(v)) throw new Error(`"${r.vintage}" isn't a vintage: use a year or NV`);
      }
      // One entry per wine and vintage; bottles add up.
      const entries = new Map<string, { row: Row; wineId: number; bottles: number }>();
      for (const r of chosen) {
        try {
          const c = r.pick >= 0 ? r.scan.candidates[r.pick] : null;
          const wineId = c
            ? (await api.confirmScan(r.scan.scanId, { wineId: c.wineId })).wineId
            : (await api.confirmScan(r.scan.scanId, { newWine: { producer: r.scan.read.producer, name: r.scan.read.name, region: r.scan.read.region } })).wineId;
          const key = `${wineId}|${r.vintage.trim().toUpperCase()}`;
          const e = entries.get(key);
          if (e) e.bottles += r.bottles;
          else entries.set(key, { row: r, wineId, bottles: r.bottles });
        } catch {
          bad.add(rows.indexOf(r));
        }
      }
      for (const e of entries.values()) {
        try {
          const vintage = e.row.vintage.trim().toUpperCase() || null;
          await api.addTasting(
            kind === 'cellar'
              ? { wineId: e.wineId, scanId: e.row.scan.scanId, vintage, kind, bottles: e.bottles }
              : { wineId: e.wineId, scanId: e.row.scan.scanId, vintage, kind, setting: 'home' }
          );
        } catch {
          bad.add(rows.indexOf(e.row));
        }
      }
      if (bad.size) {
        setFailed(bad);
        // Keep only what didn't go in, so "Add" again doesn't add the others twice.
        setRows(rows.map((r, i) => ({ ...r, include: bad.has(i) })));
        throw new Error(`${bad.size} of ${chosen.length} couldn't be added. They're still ticked below; try again.`);
      }
      onDone();
      router.push(kind === 'cellar' ? '/cellar' : '/tastings');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconButton label="Back to scan" onPress={onDone}>
          <BackIcon color={colors.text} />
        </IconButton>
        <View style={{ flex: 1 }}>
          <Eyebrow>Lineup</Eyebrow>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 20, color: colors.text }}>
            {scans.length ? `${scans.length} ${scans.length === 1 ? 'bottle' : 'bottles'} found` : 'No labels found'}
          </Text>
        </View>
        <Image source={{ uri }} style={{ width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.line2 }} />
      </View>

      {!scans.length ? (
        <Card>
          <Muted>Couldn&apos;t read any labels. Stand the bottles side by side with the front labels facing the camera, close enough to read, and try again.</Muted>
          <Button title="Try again" variant="secondary" onPress={onDone} />
        </Card>
      ) : (
        <>
          <Segmented options={[{ key: 'cellar', label: 'Add to cellar' }, { key: 'tasted', label: 'Tasted them' }]} value={kind} onChange={setKind} />
          {rows.map((r, i) => (
            <BottleRow key={r.scan.scanId} n={i + 1} row={r} kind={kind} failed={failed.has(i)} onChange={(p) => update(i, p)} />
          ))}
          <ErrorText error={error} />
          <Button
            title={chosen.length ? (kind === 'cellar' ? `Add ${chosen.length} to cellar` : `Log ${chosen.length} tastings`) : 'Nothing selected'}
            disabled={!chosen.length}
            busy={busy}
            onPress={addAll}
          />
          <Muted style={{ fontSize: 12 }}>Ratings, notes and prices can be added afterwards from My wines.</Muted>
        </>
      )}
    </Screen>
  );
}

function BottleRow({ n, row, kind, failed, onChange }: { n: number; row: Row; kind: Kind; failed: boolean; onChange: (p: Partial<Row>) => void }) {
  const { scan, pick } = row;
  const c = pick >= 0 ? scan.candidates[pick] : null;
  const unsure = scan.outcome !== 'auto';
  return (
    <Card style={[{ gap: 12, opacity: row.include ? 1 : 0.55 }, failed && { borderColor: colors.error }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.muted, marginTop: 3 }}>{n}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.text }}>
            {c ? c.displayName : `New: ${readName(scan) || 'unreadable label'}`}
          </Text>
          <Muted style={{ fontSize: 12 }}>
            {c ? [c.region, c.country].filter(Boolean).join(' · ') || ' ' : 'Not in the catalog yet; it will be added.'}
          </Muted>
          {unsure && readName(scan) ? <Muted style={{ fontSize: 12 }}>Label reads: {readName(scan)}</Muted> : null}
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.include }}
          accessibilityLabel={`Include bottle ${n}`}
          onPress={() => onChange({ include: !row.include })}
          style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, borderColor: row.include ? colors.accent : colors.line2, backgroundColor: row.include ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}
        >
          {row.include ? <Text style={{ color: colors.bg, fontFamily: fonts.semibold, fontSize: 15 }}>✓</Text> : null}
        </Pressable>
      </View>

      {unsure && scan.candidates.length ? (
        <View style={{ gap: 6 }}>
          <Eyebrow style={{ fontSize: 10 }}>{scan.outcome === 'choose' ? 'Which wine? Check this one' : 'Which wine?'}</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {scan.candidates.map((x, j) => (
              <Chip key={x.wineId} tone={pick === j ? 'gold' : 'plain'} onPress={() => onChange({ pick: j })}>{x.displayName}</Chip>
            ))}
            {readName(scan) ? <Chip tone={pick === -1 ? 'gold' : 'plain'} onPress={() => onChange({ pick: -1 })}>None: add as new</Chip> : null}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <TextInput
          accessibilityLabel={`Vintage of bottle ${n}`}
          value={row.vintage}
          onChangeText={(vintage) => onChange({ vintage })}
          placeholder="Vintage"
          placeholderTextColor={colors.faint}
          autoCapitalize="characters"
          maxLength={4}
          style={{ width: 84, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.gold, color: colors.gold, fontFamily: fonts.mono, fontSize: 13 }}
        />
        {kind === 'cellar' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button title="−" variant="pill" style={{ borderColor: colors.line2, minWidth: 36, alignItems: 'center' }} onPress={() => onChange({ bottles: Math.max(1, row.bottles - 1) })} />
            <Text style={{ fontFamily: fonts.mono, fontSize: 16, color: colors.text, minWidth: 24, textAlign: 'center' }} accessibilityLabel={`${row.bottles} bottles`}>{row.bottles}</Text>
            <Button title="+" variant="pill" style={{ borderColor: colors.line2, minWidth: 36, alignItems: 'center' }} onPress={() => onChange({ bottles: Math.min(999, row.bottles + 1) })} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
