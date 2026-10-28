/** The API address this app talks to: on the sign-in screen and in Settings. */
import { useState } from 'react';
import { Button, Card, ErrorText, Field, Heading, Muted, useTheme } from './ui';
import { checkServer, type ServerInfo } from '../lib/api';
import { getApiUrl, setApiUrl } from '../lib/config';

export function ServerSettings({ onChecking, onConnected }: { onChecking?: () => void; onConnected?: (info: ServerInfo) => void }) {
  const { c } = useTheme();
  const [server, setServer] = useState(getApiUrl());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    onChecking?.();
    try {
      const saved = await setApiUrl(server);
      setServer(saved);
      const next = await checkServer(saved);
      onConnected?.(next);
      setStatus(`Connected${next.provider === 'none' ? ' (label reading is off on this server)' : ''}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Heading>Server</Heading>
      <Muted>The WineTracker API this app talks to. On iPhone it must be an https:// address (a deployed API or a tunnel).</Muted>
      <Field label="API address" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://..." />
      <Button title="Save and check" variant="secondary" size="md" busy={busy} onPress={save} />
      {status ? <Muted style={{ color: c.positive }}>{status}</Muted> : null}
      <ErrorText error={error} />
    </Card>
  );
}
