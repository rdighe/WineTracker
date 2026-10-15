import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, ErrorText, Field, Muted, styles } from '../components/ui';
import { checkServer } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getApiUrl, setApiUrl } from '../lib/config';

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [server, setServer] = useState(getApiUrl());
  const [serverStatus, setServerStatus] = useState<string | null>(null);

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>WineTracker</Text>
      <Muted>Track the wines you taste, what they cost then and now, and find more you&apos;ll like.</Muted>
      <Card>
        {auth.devMode ? (
          <>
            <Text style={styles.h2}>Development sign-in</Text>
            <Muted>No Supabase project is configured, so pick any name (the API must run with ALLOW_DEV_AUTH=true).</Muted>
            <Field label="Name" value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="rohan" />
            <Button title="Continue" busy={busy} onPress={() => run(async () => { await auth.signInDev(email); done(); })} />
          </>
        ) : !sent ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Button title="Email me a sign-in code" busy={busy} onPress={() => run(async () => { await auth.sendCode(email.trim()); setSent(true); })} />
          </>
        ) : (
          <>
            <Muted>Enter the 6-digit code sent to {email}.</Muted>
            <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={8} />
            <Button title="Sign in" busy={busy} onPress={() => run(async () => { await auth.verifyCode(email.trim(), code.trim()); done(); })} />
            <Button title="Use a different email" variant="secondary" onPress={() => setSent(false)} />
          </>
        )}
        <ErrorText error={error} />
      </Card>
      <Card>
        <Text style={styles.h2}>Server</Text>
        <Muted>The WineTracker API this app talks to. On iPhone it must be an https:// address (a deployed API or a tunnel).</Muted>
        <Field label="API address" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://..." />
        <Button
          title="Save and check"
          variant="secondary"
          busy={busy}
          onPress={() =>
            run(async () => {
              setServerStatus(null);
              const saved = await setApiUrl(server);
              setServer(saved);
              const provider = await checkServer(saved);
              setServerStatus(`Connected${provider === 'none' ? ' (label reading is off on this server)' : ''}.`);
            })
          }
        />
        {serverStatus ? <Muted>{serverStatus}</Muted> : null}
      </Card>
    </ScrollView>
  );
}
