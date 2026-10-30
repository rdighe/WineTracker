/**
 * Cellars and sharing (from Cellar › Share): each cellar with who's in it and
 * what it holds. Owners invite a partner or a team with a link (editors add,
 * change and drink bottles; viewers only look), change roles and take people
 * out; anyone can leave, start another cellar (a locker, the office), or join
 * one with a code (app/join.tsx). ?id= puts that cellar first.
 */
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { confirm } from '../components/EntryRows';
import { PeopleIcon, PlusIcon, ShareIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button, Card, Chip, Divider, ErrorText, Field, Label, Muted, Screen, space, type, useTheme } from '../components/ui';
import { dollars } from '../lib/format';
import type { Cellar, CellarRole } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/useApi';

const ROLE: Record<CellarRole, string> = { owner: 'Owner', editor: 'Can change', viewer: 'Can look' };

export default function Cellars() {
  const api = useApi();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [cellars, setCellars] = useState<Cellar[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [newName, setNewName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { cellars: cs } = await api.cellars();
      // The cellar asked for first.
      setCellars(id ? [...cs].sort((a, b) => Number(b.cellarId === Number(id)) - Number(a.cellarId === Number(id))) : cs);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api, id]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    }
  };

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    await act(() => api.createCellar(newName.trim()));
    setNewName('');
    setBusy(false);
  }

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title="Cellars" subtitle="Keep more than one, and share one with a partner or a team" />
      <ErrorText error={error} />
      {(cellars ?? []).map((x) => <CellarCard key={x.cellarId} cellar={x} onAct={act} soleCellar={(cellars ?? []).length === 1} />)}

      <Card style={{ gap: space[3] }}>
        <Label>Another cellar</Label>
        <Muted>A wine locker, a second home, the office. Each has its own racks, receipts and people.</Muted>
        <Field label="Name" value={newName} onChangeText={setNewName} placeholder="Wine locker" returnKeyType="done" onSubmitEditing={() => void create()} />
        <Button title="Add cellar" variant="tinted" size="md" busy={busy} disabled={!newName.trim()} icon={(fg) => <PlusIcon color={fg} size={18} />} onPress={() => void create()} />
      </Card>

      <Card style={{ gap: space[3] }}>
        <Label>Have an invite?</Label>
        <Muted>Open the link you were sent, or type its code.</Muted>
        <Field label="Invite code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="k7m2q9xw4t" />
        <Button title="Join" variant="secondary" size="md" disabled={code.trim().length < 6} onPress={() => router.push(`/join?code=${encodeURIComponent(code.trim().toLowerCase())}`)} />
      </Card>
    </Screen>
  );
}

function CellarCard({ cellar: x, onAct, soleCellar }: { cellar: Cellar; onAct: (fn: () => Promise<unknown>) => Promise<void>; soleCellar: boolean }) {
  const api = useApi();
  const { c } = useTheme();
  const { label } = useAuth();
  const [name, setName] = useState(x.name);
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [sharing, setSharing] = useState(false);
  const owner = x.role === 'owner';
  const me = x.members.find((m) => m.me);
  const owners = x.members.filter((m) => m.role === 'owner').length;
  const change = x.pairedCostCents ? (x.pairedValueCents - x.pairedCostCents) / x.pairedCostCents : null;

  async function invite() {
    setSharing(true);
    await onAct(async () => {
      const { code } = await api.invite(x.cellarId, inviteRole);
      const url = Linking.createURL('join', { queryParams: { code } });
      await Share.share({
        message: `Join my cellar "${x.name}" on WineTracker${inviteRole === 'viewer' ? ' (to look)' : ''}: ${url}\n\nOr open WineTracker › Cellar › Share and type the code ${code}. It works once, for a week.`,
      });
    });
    setSharing(false);
  }

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        {x.role === 'viewer' ? (
          <Text style={[type.title3, { color: c.ink }]}>{x.name}</Text>
        ) : (
          <Field label="Cellar name" value={name} onChangeText={setName} returnKeyType="done"
            onBlur={() => { if (name.trim() && name.trim() !== x.name) void onAct(() => api.renameCellar(x.cellarId, name.trim())); }} />
        )}
        <Muted>
          {[`${x.bottles} ${x.bottles === 1 ? 'bottle' : 'bottles'}`, `${x.wines} ${x.wines === 1 ? 'wine' : 'wines'}`, x.valueCents ? `worth ${dollars(x.valueCents)}` : '',
            change !== null && Math.abs(change) >= 0.005 ? `${change > 0 ? '+' : ''}${Math.round(change * 100)}% on cost` : ''].filter(Boolean).join(' · ')}
        </Muted>
      </View>

      <View style={{ gap: space[2] }}>
        <Label>People</Label>
        {x.members.map((m, i) => (
          <View key={m.userId} style={{ gap: space[2] }}>
            {i ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.subhead, { color: c.onAccentSoft, fontWeight: '600' }]}>{((m.me ? m.name || label : m.name) || '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: c.ink }]}>{m.me ? (m.name ? `${m.name} (you)` : 'You') : m.name || 'Someone'}</Text>
                <Muted>{ROLE[m.role]}</Muted>
              </View>
            </View>
            {owner && !m.me ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 32 + space[3] }}>
                {(['owner', 'editor', 'viewer'] as const).map((r) => (
                  <Chip key={r} small selected={m.role === r} onPress={() => void onAct(() => api.setMemberRole(x.cellarId, m.userId, r))}>{ROLE[r]}</Chip>
                ))}
                <Chip small onPress={async () => {
                  if (await confirm(`Take ${m.name || 'them'} out of ${x.name}?`, 'The bottles they added stay in the cellar.', 'Take out')) void onAct(() => api.removeMember(x.cellarId, m.userId));
                }}>Take out</Chip>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {owner ? (
        <View style={{ gap: space[2] }}>
          <Label>Invite someone</Label>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Chip small selected={inviteRole === 'editor'} onPress={() => setInviteRole('editor')}>Can change bottles</Chip>
            <Chip small selected={inviteRole === 'viewer'} onPress={() => setInviteRole('viewer')}>Can only look</Chip>
          </View>
          <Button title="Send an invite link" variant="tinted" size="md" busy={sharing} icon={(fg) => <ShareIcon color={fg} size={18} />} onPress={() => void invite()} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {me && x.members.length > 1 && !(me.role === 'owner' && owners === 1) ? (
          <Button title="Leave this cellar" variant="secondary" size="sm" icon={(fg) => <PeopleIcon color={fg} size={16} />} onPress={async () => {
            if (await confirm(`Leave ${x.name}?`, "Its bottles stay with the others; you won't see them any more.", 'Leave')) void onAct(() => api.removeMember(x.cellarId, me.userId));
          }} />
        ) : null}
        {owner && !x.bottles && !soleCellar ? (
          <Button title="Delete cellar" variant="plain" size="sm" onPress={async () => {
            if (await confirm(`Delete ${x.name}?`, 'Its racks and receipts go too.', 'Delete')) void onAct(() => api.deleteCellar(x.cellarId));
          }} />
        ) : null}
      </View>
    </Card>
  );
}
