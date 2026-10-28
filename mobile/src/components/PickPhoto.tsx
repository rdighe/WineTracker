/** A saved wine list's (or shelf's) photo: private, so it loads with the person's sign-in. */
import { useEffect, useState } from 'react';
import { Image, Platform, View, type ImageStyle, type StyleProp } from 'react-native';
import { useApi } from '../lib/useApi';
import { useTheme } from './ui';

export function PickPhoto({ pickId, n, style }: { pickId: number; n: number; style: StyleProp<ImageStyle> }) {
  const api = useApi();
  const { c } = useTheme();
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void api.pickPhoto(pickId, n).then(async (s) => {
      if (Platform.OS !== 'web') return void (!cancelled && setSource(s));
      // A web <img> can't send the sign-in header: fetch it, and show the bytes.
      const res = await fetch(s.uri, { headers: s.headers });
      if (!res.ok || cancelled) return;
      objectUrl = URL.createObjectURL(await res.blob());
      setSource({ uri: objectUrl });
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, pickId, n]);
  if (!source) return <View style={[{ backgroundColor: c.surfaceSunken }, style]} />;
  return <Image source={source} style={[{ backgroundColor: c.surfaceSunken }, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}
