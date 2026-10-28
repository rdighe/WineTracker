/**
 * A wine's photo at the size its context allows. Reference photos are shop
 * packshots on white, so they sit on white in both themes and are never
 * cropped. Without one: a bottle in the wine's style color, never a stock image.
 */
import { useState, type ReactNode } from 'react';
import { Image, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { radius, size, type, useTheme, type WineStyle } from './theme';

const BOTTLE = 'M21 4h6v14c0 3 6 4 6 10v42c0 2-1 3-3 3H18c-2 0-3-1-3-3V28c0-6 6-7 6-10z';

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
  const [failed, setFailed] = useState(false);
  const has = Boolean(uri) && !failed;
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: has ? '#ffffff' : c.surfaceSunken }, style]}>
      {has ? (
        <View style={{ flex: 1, padding }}>
          <Image source={{ uri: uri! }} style={{ flex: 1 }} resizeMode="contain" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
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
