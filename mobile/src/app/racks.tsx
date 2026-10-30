/**
 * Racks (from Cellar › Racks): a cellar's racks, shelves and cases drawn as
 * grids, each place filled with its bottle's color. Tap a bottle to see it,
 * move it or take it off the rack; tap an empty place to put a bottle there
 * from those not yet on a rack. Racks can be added, renamed, resized and
 * removed (their bottles stay in the cellar). ?cellar= picks the cellar.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { confirm } from '../components/EntryRows';
import { ChevronIcon, PlusIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { WineThumb } from '../components/WineThumb';
import { Button, Card, Chip, Divider, ErrorText, Field, Label, Muted, Screen, StyleDot, radius, space, type, useTheme, wineStyleOf } from '../components/ui';
import { wineTitle } from '../lib/format';
import type { Cellar, Rack, RackSlot, Tasting } from '../lib/types';
import { useApi } from '../lib/useApi';

type Cell = { rackId: number; row: number; col: number };
const same = (a: Cell, b: Cell) => a.rackId === b.rackId && a.row === b.row && a.col === b.col;

export default function Racks() {
  const api = useApi();
  const params = useLocalSearchParams<{ cellar?: string }>();
  const [cellars, setCellars] = useState<Cellar[] | null>(null);
  const [racks, setRacks] = useState<Rack[] | null>(null);
  const [entries, setEntries] = useState<Tasting[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Cell | null>(null);
  // Moving a bottle: the place it's leaving, until an empty place is tapped.
  const [moving, setMoving] = useState<(Cell & { tastingId: number }) | null>(null);

  const cellarId = Number(params.cellar) || cellars?.[0]?.cellarId || 0;
  const cellar = cellars?.find((x) => x.cellarId === cellarId) ?? null;
  const editable = cellar ? cellar.role !== 'viewer' : false;

  const load = useCallback(async () => {
    try {
      const [cs, t] = await Promise.all([api.cellars(), api.tastings()]);
      setCellars(cs.cellars);
      const id = Number(params.cellar) || cs.cellars[0]?.cellarId;
      if (!id) return;
      setRacks((await api.racks(id)).racks);
      setEntries(t.tastings.filter((x) => x.kind === 'cellar' && x.cellar_id === id));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api, params.cellar]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const placesOf = (tastingId: number): Cell[] => (entries.find((t) => t.tasting_id === tastingId)?.places ?? []).map(({ rackId, row, col }) => ({ rackId, row, col }));
  // Bottles not on a rack yet: each entry's bottles beyond its places.
  const unplaced = useMemo(() => entries.map((t) => ({ t, free: (t.bottles ?? 1) - (t.places?.length ?? 0) })).filter((x) => x.free > 0), [entries]);
  const total = entries.reduce((s, t) => s + (t.bottles ?? 1), 0);
  const placed = entries.reduce((s, t) => s + (t.places?.length ?? 0), 0);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    }
  }

  async function tap(cell: Cell, slot: RackSlot | undefined) {
    if (moving && !slot && editable) {
      const from = moving;
      setMoving(null);
      setSelected(cell);
      return act(() => api.setPlaces(from.tastingId, [...placesOf(from.tastingId).filter((p) => !same(p, from)), cell]));
    }
    setMoving(null);
    setSelected(selected && same(selected, cell) ? null : cell);
  }

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader
        title="Racks"
        subtitle={cellar ? `${cellar.name} · ${placed} of ${total} ${total === 1 ? 'bottle' : 'bottles'} on a rack` : ' '}
      />
      {cellars && cellars.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {cellars.map((x) => (
            <Chip key={x.cellarId} small selected={x.cellarId === cellarId} onPress={() => { setSelected(null); setMoving(null); router.setParams({ cellar: String(x.cellarId) }); }}>{x.name}</Chip>
          ))}
        </View>
      ) : null}
      <ErrorText error={error} />
      {moving ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
          <Muted style={{ flex: 1 }}>Tap an empty place to move the bottle there.</Muted>
          <Button title="Cancel" variant="plain" size="sm" onPress={() => setMoving(null)} />
        </View>
      ) : null}

      {(racks ?? []).map((r) => (
        <RackCard
          key={r.rackId}
          rack={r}
          editable={editable}
          selected={selected?.rackId === r.rackId ? selected : null}
          moving={moving}
          unplaced={unplaced}
          onTap={tap}
          onPlace={(tastingId, cell) => act(() => api.setPlaces(tastingId, [...placesOf(tastingId), cell]))}
          onMove={(slot) => setMoving({ rackId: r.rackId, row: slot.row, col: slot.col, tastingId: slot.tastingId })}
          onTakeOff={(slot) => act(() => api.setPlaces(slot.tastingId, placesOf(slot.tastingId).filter((p) => !same(p, { rackId: r.rackId, row: slot.row, col: slot.col }))))}
          onAct={act}
        />
      ))}

      {racks && !racks.length ? (
        <Muted style={type.subhead}>
          {editable ? 'Draw your racks, shelves or cases as grids, then put each bottle in its place. Find a bottle will tell you where it is.' : 'No racks in this cellar yet.'}
        </Muted>
      ) : null}

      {editable && cellarId ? <NewRack onAdd={(r) => act(() => api.createRack(cellarId, r))} first={!racks?.length} /> : null}

      {racks?.length && unplaced.length ? (
        <View style={{ gap: space[2] }}>
          <Label>Not on a rack</Label>
          <Card flush>
            {unplaced.map(({ t, free }, i) => (
              <View key={t.tasting_id}>
                {i ? <Divider style={{ marginLeft: space[4] }} /> : null}
                <BottleRow t={t} detail={`${free} not placed`} onPress={() => router.push(`/wine/${t.wine_id}`)} />
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

function RackCard({ rack: r, editable, selected, moving, unplaced, onTap, onPlace, onMove, onTakeOff, onAct }: {
  rack: Rack; editable: boolean; selected: Cell | null; moving: Cell | null; unplaced: { t: Tasting; free: number }[];
  onTap: (cell: Cell, slot: RackSlot | undefined) => void; onPlace: (tastingId: number, cell: Cell) => void;
  onMove: (slot: RackSlot) => void; onTakeOff: (slot: RackSlot) => void; onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const api = useApi();
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(r.name);
  const [rows, setRows] = useState(String(r.rows));
  const [cols, setCols] = useState(String(r.cols));
  const at = new Map(r.slots.map((s) => [`${s.row}:${s.col}`, s]));
  // Places as big as fit, never too small to tap: a wide rack scrolls sideways.
  const avail = Math.min(width, 600) - 4 * space[4];
  const cell = Math.max(28, Math.min(44, Math.floor(avail / r.cols)));
  const free = r.rows * r.cols - r.slots.length;
  const sel = selected ? at.get(`${selected.row}:${selected.col}`) : undefined;

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title3, { color: c.ink }]}>{r.name}</Text>
          <Muted>{`${r.rows} ${r.rows === 1 ? 'row' : 'rows'} of ${r.cols} · ${free} free`}</Muted>
        </View>
        {editable ? <Button title={editing ? 'Done' : 'Edit'} variant="plain" size="sm" onPress={() => setEditing(!editing)} /> : null}
      </View>

      {editing ? (
        <View style={{ gap: space[3] }}>
          <Field label="Name" value={name} onChangeText={setName} />
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <View style={{ flex: 1 }}><Field label="Rows" numeric value={rows} onChangeText={setRows} /></View>
            <View style={{ flex: 1 }}><Field label="Places in a row" numeric value={cols} onChangeText={setCols} /></View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button title="Remove rack" variant="plain" size="sm" onPress={async () => {
              if (await confirm(`Remove ${r.name}?`, 'Its bottles stay in the cellar, just not on a rack.', 'Remove')) void onAct(() => api.deleteRack(r.rackId));
            }} />
            <Button title="Save" variant="tinted" size="sm" onPress={() => {
              setEditing(false);
              void onAct(() => api.updateRack(r.rackId, { name: name.trim() || r.name, rows: clamp(rows, r.rows), cols: clamp(cols, r.cols) }));
            }} />
          </View>
        </View>
      ) : null}

      <ScrollView horizontal scrollEnabled={cell * r.cols > avail} showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <View accessibilityLabel={`${r.name}, ${r.rows} rows of ${r.cols} places`} style={{ gap: 0, padding: space[2], borderRadius: radius.md, backgroundColor: c.surfaceSunken }}>
          {Array.from({ length: r.rows }, (_, row) => (
            <View key={row} style={{ flexDirection: 'row' }}>
              {Array.from({ length: r.cols }, (_, col) => {
                const slot = at.get(`${row}:${col}`);
                const isSel = selected?.row === row && selected?.col === col;
                const isFrom = moving?.rackId === r.rackId && moving.row === row && moving.col === col;
                const st = slot ? wineStyleOf(slot.colour, slot.wineType) : null;
                // Selected (or being moved): a ring around the place, in ink, so it shows on any wine's color.
                const ring = isSel || isFrom;
                const d = cell - 12;
                return (
                  <Pressable
                    key={col}
                    accessibilityRole="button"
                    accessibilityLabel={`Row ${row + 1}, place ${col + 1}: ${slot ? `${slot.name}${slot.vintage ? ` ${slot.vintage}` : ''}` : 'empty'}`}
                    accessibilityState={{ selected: isSel }}
                    onPress={() => onTap({ rackId: r.rackId, row, col }, slot)}
                    style={{ width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View style={{ width: d + 8, height: d + 8, borderRadius: (d + 8) / 2, borderWidth: 2, borderColor: ring ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{
                        width: d, height: d, borderRadius: d / 2,
                        backgroundColor: st ? c.style[st] : 'transparent',
                        borderWidth: st ? 0 : 1.5, borderColor: c.borderControl, borderStyle: st ? 'solid' : 'dashed',
                        opacity: isFrom ? 0.45 : 1,
                      }} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {selected && sel ? (
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <StyleDot wineStyle={wineStyleOf(sel.colour, sel.wineType)} />
            <Text style={[type.wineTitle, { color: c.ink, flex: 1 }]} numberOfLines={2}>{`${sel.name}${sel.vintage ? ` ${sel.vintage}` : ''}`}</Text>
          </View>
          <Muted>{`Row ${sel.row + 1}, place ${sel.col + 1}`}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button title="Wine page" variant="secondary" size="sm" onPress={() => router.push(`/wine/${sel.wineId}`)} icon={(fg) => <ChevronIcon color={fg} size={14} />} />
            {editable ? <Button title="Move" variant="tinted" size="sm" onPress={() => onMove(sel)} /> : null}
            {editable ? <Button title="Take off the rack" variant="plain" size="sm" onPress={() => onTakeOff(sel)} /> : null}
          </View>
        </View>
      ) : selected && editable && !moving ? (
        <View style={{ gap: space[2] }}>
          <Muted>{`Row ${selected.row + 1}, place ${selected.col + 1} is free.${unplaced.length ? ' Put a bottle here:' : ' Every bottle is on a rack.'}`}</Muted>
          {unplaced.length ? (
            <View style={{ borderRadius: radius.md, backgroundColor: c.surfaceSunken }}>
              {unplaced.map(({ t, free: n }, i) => (
                <View key={t.tasting_id}>
                  {i ? <Divider style={{ marginLeft: space[4] }} /> : null}
                  <BottleRow t={t} detail={`${n} not placed`} onPress={() => onPlace(t.tasting_id, selected)} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const clamp = (v: string, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(40, n) : fallback;
};

function NewRack({ onAdd, first }: { onAdd: (r: { name: string; rows: number; cols: number }) => Promise<void>; first: boolean }) {
  const [open, setOpen] = useState(first);
  const [name, setName] = useState('');
  const [rows, setRows] = useState('4');
  const [cols, setCols] = useState('6');
  if (!open) return <Button title="Add a rack" variant="secondary" size="md" icon={(fg) => <PlusIcon color={fg} size={18} />} onPress={() => setOpen(true)} />;
  return (
    <Card style={{ gap: space[3] }}>
      <Label>{first ? 'Your first rack' : 'Add a rack'}</Label>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Kitchen rack" />
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View style={{ flex: 1 }}><Field label="Rows" numeric value={rows} onChangeText={setRows} /></View>
        <View style={{ flex: 1 }}><Field label="Places in a row" numeric value={cols} onChangeText={setCols} /></View>
      </View>
      <Button title="Add rack" variant="tinted" size="md" disabled={!name.trim()} onPress={() => {
        void onAdd({ name: name.trim(), rows: clamp(rows, 4), cols: clamp(cols, 6) }).then(() => {
          setName('');
          setOpen(false);
        });
      }} />
    </Card>
  );
}

function BottleRow({ t, detail, onPress }: { t: Tasting; detail: string; onPress: () => void }) {
  const { c } = useTheme();
  const name = wineTitle(t.display_name, t.sub_region);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${t.vintage_key ? ` ${t.vintage_key}` : ''}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], paddingHorizontal: space[4] }, pressed && { backgroundColor: c.fillQuiet }]}
    >
      <WineThumb uri={t.image_url} wineStyle={wineStyleOf(t.colour, t.wine_type)} width={32} height={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.subhead, { color: c.ink, fontWeight: '600' }]} numberOfLines={1}>{name}</Text>
        <Muted>{[t.vintage_key ?? 'NV', detail].join(' · ')}</Muted>
      </View>
    </Pressable>
  );
}
