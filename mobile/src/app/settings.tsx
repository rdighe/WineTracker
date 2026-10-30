/** You › Settings (from the avatar on each tab): appearance, location, account, importing from Vivino, and the tour. */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppearanceSettings } from '../components/Appearance';
import { LocationSettings } from '../components/LocationSettings';
import { CellarTrackerImport } from '../components/CellarTrackerImport';
import { VivinoImport } from '../components/VivinoImport';
import { BackIcon } from '../components/icons';
import { Button, Card, Chip, Field, Heading, IconButton, Muted, Screen, Title, space, type, useTheme } from '../components/ui';
import { useApi } from '../lib/useApi';
import { tour } from '../lib/tour';
import { useAuth } from '../lib/auth';

export default function Settings() {
  const { label, signOut } = useAuth();
  const { c } = useTheme();
  return (
    <Screen tabBar={false}>
      <View style={{ marginLeft: -space[2] }}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
      </View>
      <Title>Settings</Title>
      <Card>
        <Heading>Your taste</Heading>
        <Muted style={type.subhead}>Your taste card: what your ratings say you like. Change it, or share it with friends to see how alike you are.</Muted>
        <Button title="Open your taste card" variant="tinted" size="sm" onPress={() => router.push('/taste')} />
      </Card>
      <AppearanceSettings />
      <LocationSettings />
      <ListHistory />
      <Card>
        <Heading>Account</Heading>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
          <Muted style={[type.subhead, { flex: 1 }]} numberOfLines={1}>Signed in as {label}</Muted>
          <Button title="Sign out" variant="secondary" size="sm" onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
        </View>
      </Card>
      <PublicName />
      <CellarTrackerImport />
      <VivinoImport />
      <Card>
        <Heading>Taste quiz</Heading>
        <Muted style={type.subhead}>{"90 seconds on the wines you like and what you spend. It shapes your picks until you've rated 15 wines."}</Muted>
        <Button title="Retake the taste quiz" variant="secondary" size="sm" onPress={() => router.push('/welcome?redo=1')} />
      </Card>
      <Card>
        <Heading>The tour</Heading>
        <Muted style={type.subhead}>A one-minute look at Home, wine lists and shelves, adding bottles and your cellar.</Muted>
        <Button title="Show the tour" variant="secondary" size="sm" onPress={async () => { await tour.reset(); router.dismissTo('/?tour=1'); }} />
      </Card>
      <Muted style={{ textAlign: 'center' }}>WineTracker {Constants.expoConfig?.version ?? ''}</Muted>
    </Screen>
  );
}

/** The name shown with community notes and on a shared taste card. */
function PublicName() {
  const api = useApi();
  const [name, setName] = useState('');
  const [shownAs, setShownAs] = useState('');
  const [saved, setSaved] = useState(false);
  const [unblocked, setUnblocked] = useState<number | null>(null);
  useEffect(() => {
    api.me().then((m) => { setName(m.public_name); setShownAs(m.shown_as); }, () => {});
  }, [api]);
  const save = async () => {
    await api.setPublicName(name.trim()).catch(() => {});
    const m = await api.me().catch(() => null);
    if (m) setShownAs(m.shown_as);
    setSaved(true);
  };
  return (
    <Card>
      <Heading>Your name in the community</Heading>
      <Muted style={type.subhead}>{`Shown with notes you share and on your taste card, never your email. Now: ${shownAs || '…'}.`}</Muted>
      <Field label="Name to show" value={name} onChangeText={(t) => { setName(t); setSaved(false); }} placeholder="First name and initial" maxLength={40} onSubmitEditing={() => void save()} returnKeyType="done" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Button title={saved ? 'Saved' : 'Save name'} variant="secondary" size="sm" disabled={saved} onPress={() => void save()} />
        <Button title="Unblock everyone" variant="plain" size="sm" onPress={() => void api.unblockAll().then((r) => setUnblocked(r.unblocked), () => {})} />
      </View>
      {unblocked !== null ? <Muted>{unblocked ? `Unblocked ${unblocked}.` : 'You had blocked no one.'}</Muted> : null}
    </Card>
  );
}

const KEEP_OPTIONS = [{ days: 0, label: "Don't keep" }, { days: 7, label: '7 days' }, { days: 14, label: '14 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }];

/** How long wine lists and shelves you don't save stay under Lists › Recent. */
function ListHistory() {
  const api = useApi();
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    api.me().then((m) => setDays(m.pick_history_days ?? 14), () => setDays(14));
  }, [api]);
  return (
    <Card>
      <Heading>Wine lists and shelves</Heading>
      <Muted style={type.subhead}>Ones you don&apos;t save stay under Lists › Recent for this long, then they&apos;re deleted.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {KEEP_OPTIONS.map((o) => (
          <Chip key={o.days} small selected={days === o.days} onPress={() => { setDays(o.days); void api.setPickHistoryDays(o.days).catch(() => {}); }}>{o.label}</Chip>
        ))}
      </View>
    </Card>
  );
}
