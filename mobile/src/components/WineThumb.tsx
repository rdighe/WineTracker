/**
 * A wine's photo at the size its context allows. Reference photos are shop
 * packshots on white, so they sit on white in both themes and are never
 * cropped. Without one: a bottle in the wine's style color on its wash, never a stock image.
 */
import { useState, type ReactNode } from 'react';
import { Image, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getApiUrl } from '../lib/config';
import { radius, size, type, useTheme, type WineStyle } from './theme';

const BOTTLE = 'M21 4h6v14c0 3 6 4 6 10v42c0 2-1 3-3 3H18c-2 0-3-1-3-3V28c0-6 6-7 6-10z';

/**
 * Shop photos load through our API (GET /api/photo), which fetches each one
 * once and serves a resized copy: the phone can't load plain-http shop links,
 * and some shops refuse images asked for from elsewhere. Local photos (a label
 * scan) and data URIs are shown as they are.
 */
export function photoSource(uri: string): string {
  const api = getApiUrl();
  return /^https?:\/\//.test(uri) && !uri.startsWith(api) ? `${api}/api/photo?u=${encodeURIComponent(uri)}` : uri;
}

/** Small portrait thumbnail for list rows. */
export function WineThumb({ uri, wineStyle = 'red', width = size.thumbW, height = size.thumbH }: { uri: string | null | undefined; wineStyle?: WineStyle; width?: number; height?: number }) {
  return <WinePhoto uri={uri} wineStyle={wineStyle} style={{ width, height, borderRadius: radius.xs }} padding={Math.round(width / 14)} />;
}

/**
 * Any size: give it width/height (or aspectRatio) and a borderRadius in
 * `style`. Glass controls go in `children` and float over the photo.
 */
export function WinePhoto({ uri, wineStyle = 'red', style, padding = 0, emptyLabel, children }: {
  uri: string | null | undefined; wineStyle?: WineStyle; style?: StyleProp<ViewStyle>; padding?: number; emptyLabel?: string; children?: ReactNode;
}) {
  const { c } = useTheme();
  // Through the API first; if that fails (an older server), the shop's own URL; then the placeholder.
  const [attempt, setAttempt] = useState<{ uri: typeof uri; n: number }>({ uri, n: 0 });
  const n = attempt.uri === uri ? attempt.n : 0;
  const src = uri ? (n === 0 ? photoSource(uri) : n === 1 && photoSource(uri) !== uri ? uri : null) : null;
  const has = Boolean(src);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: has ? '#ffffff' : c.wash[wineStyle] }, style]}>
      {has ? (
        <View style={{ flex: 1, padding }}>
          <Image source={{ uri: src! }} style={{ flex: 1 }} resizeMode="contain" onError={() => setAttempt({ uri, n: n + 1 })} accessibilityIgnoresInvertColors />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }} accessible accessibilityLabel="No photo">
          <Svg viewBox="0 0 48 76" style={{ height: '46%', aspectRatio: 48 / 76, maxHeight: 200 }}>
            <Path d={BOTTLE} fill={c.style[wineStyle]} />
          </Svg>
          {emptyLabel ? <Text style={[type.footnote, { color: c.ink3 }]}>{emptyLabel}</Text> : null}
        </View>
      )}
      {children}
    </View>
  );
}
