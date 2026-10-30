/** You › Settings (from the avatar on each tab): appearance, location, account, importing from Vivino, and the tour. */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { View } from 'react-native';
import { AppearanceSettings } from '../components/Appearance';
import { LocationSettings } from '../components/LocationSettings';
import { VivinoImport } from '../components/VivinoImport';
import { BackIcon } from '../components/icons';
import { Button, Card, Heading, IconButton, Muted, Screen, Title, space, type, useTheme } from '../components/ui';
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
      <AppearanceSettings />
      <LocationSettings />
      <Card>
        <Heading>Account</Heading>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
          <Muted style={[type.subhead, { flex: 1 }]} numberOfLines={1}>Signed in as {label}</Muted>
          <Button title="Sign out" variant="secondary" size="sm" onPress={async () => { await signOut(); router.replace('/sign-in'); }} />
        </View>
      </Card>
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
