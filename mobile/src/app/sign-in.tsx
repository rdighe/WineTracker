import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, ErrorText, Field, Heading, Muted, Screen, space, type, useTheme } from '../components/ui';
import { checkServer, type ServerInfo } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getApiUrl, setApiUrl } from '../lib/config';

export default function SignIn() {
  const auth = useAuth();
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [server, setServer] = useState(getApiUrl());
  const [serverStatus, setServerStatus] = useState<string | null>(null);
  const [serverError, setServerError] = useState<unknown>(null);
  // How the current server signs people in; null while checking or unreachable.
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    checkServer(getApiUrl()).then(setInfo, setServerError);
  }, []);

  const run = async (fn: () => Promise<void>, onError = setError) => {
    setBusy(true);
    onError(null);
    try {
      await fn();
    } catch (e) {
      onError(e);
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
          Every bottle you taste, and what it&apos;s worth now.
        </Text>
        <Muted style={type.body}>Scan a label, log what you paid, and find more you&apos;ll like.</Muted>
      </View>

      <Card>
        {!info ? (
          <Muted style={type.subhead}>{serverError ? 'Can\'t reach the server below. Check its address.' : 'Connecting…'}</Muted>
        ) : (
          <>
            {info.signIn.includes('google') ? (
              <Button title="Continue with Google" busy={busy} onPress={() => run(async () => { if (await auth.signInGoogle()) done(); })} />
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

      <Card>
        <Heading>Server</Heading>
        <Muted>The WineTracker API this app talks to. On iPhone it must be an https:// address (a deployed API or a tunnel).</Muted>
        <Field label="API address" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://..." />
        <Button
          title="Save and check"
          variant="secondary"
          size="md"
          busy={busy}
          onPress={() =>
            run(async () => {
              setServerStatus(null);
              setInfo(null);
              const saved = await setApiUrl(server);
              setServer(saved);
              const next = await checkServer(saved);
              setInfo(next);
              setServerStatus(`Connected${next.provider === 'none' ? ' (label reading is off on this server)' : ''}.`);
            }, setServerError)
          }
        />
        {serverStatus ? <Muted style={{ color: c.positive }}>{serverStatus}</Muted> : null}
        <ErrorText error={serverError} />
      </Card>
    </Screen>
  );
}
