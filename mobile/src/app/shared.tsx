/**
 * Photos or a PDF shared to the app from another app's share sheet: read as
 * a wine list or a store shelf. A PDF is a wine list; photos ask which.
 * Signed out, it waits for sign-in (the share is kept until it's read).
 */
import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ListIcon, ShelfIcon } from '../components/icons';
import { Button, Card, Heading, IconButton, Muted, Screen, Title, space, type, useTheme } from '../components/ui';
import { useAuth } from '../lib/auth';
import { holdSharedFiles, isImage, isPdf, type SharedFile } from '../lib/sharedFiles';

/** Pages a list can have (the server's limit). */
const MAX_FILES = 8;

export default function SharedScreen() {
  const { c } = useTheme();
  const { ready: authReady, signedIn } = useAuth();
  const { isReady, hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const files: SharedFile[] = (shareIntent.files ?? [])
    .map((f) => ({ uri: f.path, mimeType: f.mimeType ?? '', width: f.width, height: f.height }))
    .filter((f) => isPdf(f) || isImage(f))
    .slice(0, MAX_FILES);
  const hasPdf = files.some(isPdf);

  function read(kind: 'list' | 'shelf') {
    holdSharedFiles(kind === 'shelf' ? files.filter(isImage).slice(0, 1) : files);
    resetShareIntent();
    router.replace({ pathname: '/picks', params: { kind, shared: '1' } });
  }

  // A PDF can only be a wine list: straight there.
  const readNow = isReady && authReady && signedIn && hasPdf;
  useEffect(() => {
    if (readNow) read('list');
    // read() only uses what readNow depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readNow]);

  const close = () => {
    resetShareIntent();
    router.replace('/');
  };
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Title>Shared with WineTracker</Title>
      <IconButton label="Close" onPress={close} size={36}>
        <Text style={[type.headline, { color: c.ink2, lineHeight: 20 }]}>×</Text>
      </IconButton>
    </View>
  );

  if (!isReady || !authReady || readNow) {
    return (
      <Screen>
        {header}
        <ActivityIndicator style={{ marginTop: space[6] }} />
      </Screen>
    );
  }
  if (!signedIn) {
    return (
      <Screen>
        {header}
        <Card>
          <Heading>Sign in to read this</Heading>
          <Muted>{`Your shared ${files.length === 1 ? 'file is' : 'files are'} kept until you're signed in.`}</Muted>
          <Button title="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      </Screen>
    );
  }
  if (!hasShareIntent || !files.length) {
    return (
      <Screen>
        {header}
        <Card>
          <Heading>Nothing to read</Heading>
          <Muted>Share photos of a wine list or a store shelf, or a wine list as a PDF.</Muted>
          <Button title="Done" variant="secondary" onPress={close} />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      {header}
      <Card>
        <Heading>{files.length === 1 ? 'What is this photo of?' : `What are these ${files.length} photos of?`}</Heading>
        <View style={{ gap: space[2] }}>
          <Button title="A wine list" icon={(color) => <ListIcon color={color} size={20} />} onPress={() => read('list')} />
          <Button title="A store shelf" variant="secondary" icon={(color) => <ShelfIcon color={color} size={20} />} onPress={() => read('shelf')} />
        </View>
        {files.length > 1 ? <Muted>A shelf is read from the first photo.</Muted> : null}
      </Card>
    </Screen>
  );
}
