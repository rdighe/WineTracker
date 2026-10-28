/**
 * Liquid glass: the one material for everything that floats over content
 * (tab bar, toolbar, buttons on a photo). Native Liquid Glass on iOS 26, which
 * follows the phone's Clear/Tinted, Reduce Transparency and Increase Contrast
 * settings by itself; elsewhere a blur with the design system's glass fills.
 * Never use it for content: cards, lists and prices stay on solid surfaces.
 */
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './theme';

const NATIVE = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function Glass({ children, style, tint, interactive }: {
  children?: ReactNode;
  /** Give it a borderRadius; glass is always a rounded shape. */
  style?: StyleProp<ViewStyle>;
  /** The single primary action on the glass layer. */
  tint?: boolean;
  interactive?: boolean;
}) {
  const { c, scheme, glass } = useTheme();

  // Reduce Transparency (or the in-app "Solid" choice): a plain raised surface.
  if (glass === 'solid') {
    return (
      <View
        style={[
          { backgroundColor: tint ? c.accent : c.surfaceRaised, borderWidth: 1, borderColor: c.hairline },
          lift(scheme, 'pop'),
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  // Native glass already darkens its edges for Increase Contrast.
  if (NATIVE) {
    return (
      <GlassView
        style={style}
        colorScheme={scheme}
        isInteractive={interactive}
        // "device" lets iOS apply the person's Clear or Tinted setting; the in-app choice overrides it.
        glassEffectStyle={glass === 'clear' ? 'clear' : 'regular'}
        tintColor={tint ? c.glassTint : glass === 'tinted' ? c.glassFillTinted : undefined}
      >
        {children}
      </GlassView>
    );
  }

  const fill = tint ? (glass === 'contrast' ? c.accent : c.glassTint) : glass === 'tinted' || glass === 'contrast' ? c.glassFillTinted : c.glassFill;
  return (
    <View style={[{ borderWidth: 1, borderColor: glass === 'contrast' ? c.borderControl : c.glassStroke, overflow: 'hidden' }, lift(scheme, 'glass'), style]}>
      <BlurView intensity={40} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {children}
    </View>
  );
}

/** Elevation: a soft lift in light mode; dark mode leans on hairlines instead. */
export function lift(scheme: 'light' | 'dark', kind: 'card' | 'glass' | 'pop'): ViewStyle {
  const dark = scheme === 'dark';
  if (kind === 'card') return dark ? {} : { shadowColor: '#1c0a12', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 };
  return { shadowColor: dark ? '#000000' : '#1c0a12', shadowOpacity: dark ? 0.55 : kind === 'pop' ? 0.16 : 0.14, shadowRadius: kind === 'pop' ? 20 : 14, shadowOffset: { width: 0, height: kind === 'pop' ? 12 : 8 }, elevation: 6 };
}
