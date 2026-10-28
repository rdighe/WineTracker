/** A saved wine list's (or shelf's) photo: private, so it loads with the person's sign-in. */
import { useEffect, useState } from 'react';
import { Image, View, type ImageStyle, type StyleProp } from 'react-native';
import { useApi } from '../lib/useApi';
import { useTheme } from './ui';

export function PickPhoto({ pickId, n, style }: { pickId: number; n: number; style: StyleProp<ImageStyle> }) {
  const api = useApi();
  const { c } = useTheme();
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api.pickPhoto(pickId, n).then((s) => !cancelled && setSource(s));
    return () => {
      cancelled = true;
    };
  }, [api, pickId, n]);
  if (!source) return <View style={[{ backgroundColor: c.surfaceSunken }, style]} />;
  return <Image source={source} style={[{ backgroundColor: c.surfaceSunken }, style]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}
