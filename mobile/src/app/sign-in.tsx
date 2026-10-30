import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { GoogleLogo } from '../components/icons';
import { Button, Card, ErrorText, Field, Heading, Muted, Screen, radius, size, space, type, useTheme } from '../components/ui';
import { checkServer, type ServerInfo } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getApiUrl } from '../lib/config';

export default function SignIn() {
  const auth = useAuth();
  const { c, scheme } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [serverError, setServerError] = useState<unknown>(null);
  // How the current server signs people in; null while checking or unreachable.
  const [info, setInfo] = useState<ServerInfo | null>(null);
  // Sign in with Apple: iOS 13+ only.
  const [appleAvailable, setAppleAvailable] = useState(false);

  const connect = () => checkServer(getApiUrl()).then(setInfo, setServerError);
  const retry = () => {
    setServerError(null);
    connect();
  };
  useEffect(() => {
    connect();
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable, () => {});
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const done = () => router.replace('/');

  return (
    <Screen tabBar={false}>
      <View style={{ marginTop: space[6], marginBottom: space[2], gap: space[3] }}>
        <Text style={[type.wineTitle, { fontSize: 22, fontWeight: '600', color: c.accent }]}>WineTracker</Text>
        <Text accessibilityRole="header" style={[type.largeTitle, { color: c.ink }]}>
          Find wines you&apos;ll love and track your wine journey, all in one place
        </Text>
      </View>

      <Card>
        {!info ? (
          serverError ? (
            <>
              <Muted style={type.subhead}>Can&apos;t reach WineTracker. Check your connection and try again.</Muted>
              <Button title="Try again" variant="secondary" size="md" onPress={retry} />
            </>
          ) : (
            <Muted style={type.subhead}>Connecting…</Muted>
          )
        ) : (
          <>
            {info.signIn.includes('google') ? (
              <Button
                title="Sign in with Google"
                variant="secondary"
                icon={() => <GoogleLogo />}
                busy={busy}
                onPress={() => run(async () => { if (await auth.signInGoogle()) done(); })}
              />
            ) : null}
            {appleAvailable && info.signIn.includes('apple') ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={scheme === 'dark' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radius.pill}
                style={{ height: size.controlLg, opacity: busy ? 0.45 : 1 }}
                onPress={() => { if (!busy) run(async () => { if (await auth.signInApple()) done(); }); }}
              />
            ) : null}
            {info.signIn.includes('dev') ? (
              <>
                <Heading>Development sign-in</Heading>
                <Muted>This server accepts any name (ALLOW_DEV_AUTH=true).</Muted>
                <Field label="Name" value={name} onChangeText={setName} autoCapitalize="none" placeholder="rohan" />
                <Button title="Continue" variant={info.signIn.includes('google') ? 'tinted' : undefined} busy={busy} onPress={() => run(async () => { await auth.signInDev(name); done(); })} />
              </>
            ) : null}
            {!info.signIn.length ? <Muted>This server has no sign-in set up.</Muted> : null}
          </>
        )}
        <ErrorText error={error} />
      </Card>
    </Screen>
  );
}
