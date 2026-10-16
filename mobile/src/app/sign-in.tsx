import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, ErrorText, Eyebrow, Field, Muted, Screen, colors, fonts } from '../components/ui';
import { checkServer, type ServerInfo } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getApiUrl, setApiUrl } from '../lib/config';

export default function SignIn() {
  const auth = useAuth();
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
      <View style={{ marginTop: 24, marginBottom: 8, gap: 10 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 3.6, textTransform: 'uppercase', color: colors.text }}>WineTracker</Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.text }}>
          Every bottle you taste, and what it&apos;s worth now.
        </Text>
        <Muted>Scan a label, log what you paid, and find more you&apos;ll like.</Muted>
      </View>

      <Card>
        {!info ? (
          <Muted>{serverError ? 'Can\'t reach the server below. Check its address.' : 'Connecting…'}</Muted>
        ) : (
          <>
            {info.signIn.includes('google') ? (
              <Button title="Continue with Google" busy={busy} onPress={() => run(async () => { if (await auth.signInGoogle()) done(); })} />
            ) : null}
            {info.signIn.includes('dev') ? (
              <>
                <Eyebrow>Development sign-in</Eyebrow>
                <Muted>This server accepts any name (ALLOW_DEV_AUTH=true).</Muted>
                <Field label="Name" value={name} onChangeText={setName} autoCapitalize="none" placeholder="rohan" />
                <Button title="Continue" variant={info.signIn.includes('google') ? 'secondary' : undefined} busy={busy} onPress={() => run(async () => { await auth.signInDev(name); done(); })} />
              </>
            ) : null}
            {!info.signIn.length ? <Muted>This server has no sign-in set up.</Muted> : null}
          </>
        )}
        <ErrorText error={error} />
      </Card>

      <Card>
        <Eyebrow>Server</Eyebrow>
        <Muted>The WineTracker API this app talks to. On iPhone it must be an https:// address (a deployed API or a tunnel).</Muted>
        <Field label="API address" mono value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://..." />
        <Button
          title="Save and check"
          variant="secondary"
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
        {serverStatus ? <Muted style={{ color: colors.gold }}>{serverStatus}</Muted> : null}
        <ErrorText error={serverError} />
      </Card>
    </Screen>
  );
}
