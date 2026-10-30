/** Settings: appearance, location, account, and importing from Vivino. */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { View } from 'react-native';
import { AppearanceSettings } from '../../components/Appearance';
import { LocationSettings } from '../../components/LocationSettings';
import { VivinoImport } from '../../components/VivinoImport';
import { Button, Card, Heading, Muted, Screen, Title, space, type } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function Settings() {
  const { label, signOut } = useAuth();
  return (
    <Screen>
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
      <Muted style={{ textAlign: 'center' }}>WineTracker {Constants.expoConfig?.version ?? ''}</Muted>
    </Screen>
  );
}
