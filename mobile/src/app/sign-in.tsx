import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, ErrorText, Field, Muted, styles } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
    </ScrollView>
  );
}
