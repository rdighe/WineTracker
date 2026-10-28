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
import { BackIcon, CheckIcon } from './icons';
import { Button, Card, Chip, ErrorText, IconButton, Label, Muted, Screen, Segmented, radius, space, type, useStyles, useTheme } from './ui';

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
  const { c } = useTheme();
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
      router.dismissTo(kind === 'cellar' ? '/wines?mode=cellar' : '/wines?mode=tastings');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <IconButton label="Back to scan" onPress={onDone}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
        <View style={{ flex: 1 }}>
          <Muted>Lineup</Muted>
          <Text accessibilityRole="header" style={[type.title2, { color: c.ink }]}>
            {scans.length ? `${scans.length} ${scans.length === 1 ? 'bottle' : 'bottles'} found` : 'No labels found'}
          </Text>
        </View>
      </View>
      <Image source={{ uri }} accessibilityLabel="Your lineup photo" style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: c.surfaceSunken }} resizeMode="cover" />

      {!scans.length ? (
        <Card>
          <Muted style={type.subhead}>Couldn&apos;t read any labels. Stand the bottles side by side with the front labels facing the camera, close enough to read, and try again.</Muted>
          <Button title="Try again" variant="secondary" size="md" onPress={onDone} />
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
          <Muted>Ratings, notes and prices can be added afterwards from My wines.</Muted>
        </>
      )}
    </Screen>
  );
}

function BottleRow({ n, row, kind, failed, onChange }: { n: number; row: Row; kind: Kind; failed: boolean; onChange: (p: Partial<Row>) => void }) {
  const { c, scheme } = useTheme();
  const s = useStyles();
  const { scan, pick } = row;
  const x = pick >= 0 ? scan.candidates[pick] : null;
  const unsure = scan.outcome !== 'auto';
  return (
    <Card style={[{ gap: space[3], opacity: row.include ? 1 : 0.6 }, failed && { borderColor: c.negative, borderWidth: 1.5 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <Text style={[type.footnote, type.tabular, { color: c.ink3, marginTop: 4 }]}>{n}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.wineTitle, { color: c.ink }]}>
            {x ? x.displayName : `New: ${readName(scan) || 'unreadable label'}`}
          </Text>
          <Muted>
            {x ? [x.region, x.country].filter(Boolean).join(' · ') || ' ' : 'Not in the catalog yet; it will be added.'}
          </Muted>
          {unsure && readName(scan) ? <Muted style={{ color: c.caution }}>Label reads: {readName(scan)}</Muted> : null}
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: row.include }}
          accessibilityLabel={`Include bottle ${n}`}
          onPress={() => onChange({ include: !row.include })}
          hitSlop={8}
          style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: row.include ? c.accent : c.borderControl, backgroundColor: row.include ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}
        >
          {row.include ? <CheckIcon color={c.onAccent} size={15} /> : null}
        </Pressable>
      </View>

      {unsure && scan.candidates.length ? (
        <View style={{ gap: 6 }}>
          <Label>{scan.outcome === 'choose' ? 'Which wine? Check this one' : 'Which wine?'}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {scan.candidates.map((cand, j) => (
              <Chip key={cand.wineId} small selected={pick === j} onPress={() => onChange({ pick: j })}>{cand.displayName}</Chip>
            ))}
            {readName(scan) ? <Chip small selected={pick === -1} onPress={() => onChange({ pick: -1 })}>None: add as new</Chip> : null}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
        <TextInput
          accessibilityLabel={`Vintage of bottle ${n}`}
          value={row.vintage}
          onChangeText={(vintage) => onChange({ vintage })}
          placeholder="Vintage"
          placeholderTextColor={c.ink3}
          autoCapitalize="characters"
          keyboardAppearance={scheme}
          maxLength={4}
          style={[s.input, type.tabular, { width: 96, textAlign: 'center' }]}
        />
        {kind === 'cellar' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Button title="−" variant="secondary" size="sm" accessibilityLabel="One bottle fewer" onPress={() => onChange({ bottles: Math.max(1, row.bottles - 1) })} />
            <Text style={[type.headline, type.tabular, { color: c.ink, minWidth: 28, textAlign: 'center' }]} accessibilityLabel={`${row.bottles} bottles`}>{row.bottles}</Text>
            <Button title="+" variant="secondary" size="sm" accessibilityLabel="One bottle more" onPress={() => onChange({ bottles: Math.min(999, row.bottles + 1) })} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
