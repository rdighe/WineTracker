/** Private photos (a saved wine list's or shelf's, a receipt's): they load with the person's sign-in. */
import { useEffect, useState } from 'react';
import { Image, Platform, View, type ImageStyle, type StyleProp } from 'react-native';
import { useApi } from '../lib/useApi';
import { useTheme } from './ui';

type Source = { uri: string; headers?: Record<string, string> };

export function PickPhoto({ pickId, n, style, fit = 'cover' }: { pickId: number; n: number; style: StyleProp<ImageStyle>; fit?: 'cover' | 'contain' }) {
  const api = useApi();
  return <PrivatePhoto load={() => api.pickPhoto(pickId, n)} id={`pick:${pickId}:${n}`} style={style} fit={fit} />;
}

export function ReceiptPhoto({ receiptId, style, fit = 'cover' }: { receiptId: number; style: StyleProp<ImageStyle>; fit?: 'cover' | 'contain' }) {
  const api = useApi();
  return <PrivatePhoto load={() => api.receiptPhoto(receiptId)} id={`receipt:${receiptId}`} style={style} fit={fit} />;
}

/** `id` names the photo: a new id loads a new one. */
function PrivatePhoto({ load, id, style, fit }: { load: () => Promise<Source>; id: string; style: StyleProp<ImageStyle>; fit: 'cover' | 'contain' }) {
  const { c } = useTheme();
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void load().then(async (s) => {
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
    // The photo is named by id; load is a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!source) return <View style={[{ backgroundColor: c.surfaceSunken }, style]} />;
  return <Image source={source} style={[{ backgroundColor: c.surfaceSunken }, style]} resizeMode={fit} accessibilityIgnoresInvertColors />;
}
