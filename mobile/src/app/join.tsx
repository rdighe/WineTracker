/**
 * Joining a shared cellar: an invite link (winetracker://join?code=…) or a
 * code typed in Cellars lands here. It says whose cellar it is and what you'll
 * be able to do, then adds you and opens the Cellar.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { PeopleIcon } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Button, Card, ErrorText, Muted, Screen, space, type, useTheme } from '../components/ui';
import type { InvitePreview } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function Join() {
  const api = useApi();
  const { c } = useTheme();
  const { code = '' } = useLocalSearchParams<{ code?: string }>();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.previewInvite(code).then((p) => !cancelled && setInvite(p), (e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [api, code]);

  async function accept() {
    setBusy(true);
    try {
      await api.acceptInvite(code);
      router.dismissTo('/cellar');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Screen tabBar={false} contentContainerStyle={{ gap: space[5] }}>
      <ScreenHeader title="Join a cellar" />
      <ErrorText error={error} />
      {!invite && !error ? <ActivityIndicator color={c.ink3} /> : null}
      {invite ? (
        <Card style={{ gap: space[4], alignItems: 'flex-start' }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <PeopleIcon color={c.onAccentSoft} size={28} />
          </View>
          <View style={{ gap: space[1] }}>
            <Text style={[type.title3, { color: c.ink }]}>{invite.cellarName}</Text>
            <Muted>
              {invite.member
                ? "You're already in this cellar."
                : `${invite.from || 'Someone'} invited you. You'll ${invite.role === 'viewer' ? 'see its bottles, racks and receipts' : 'see its bottles and can add, move and drink them, and file receipts'}.`}
            </Muted>
          </View>
          {invite.member ? (
            <Button title="Open the Cellar" variant="secondary" onPress={() => router.dismissTo('/cellar')} />
          ) : (
            <Button title={`Join ${invite.cellarName}`} busy={busy} onPress={() => void accept()} />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
