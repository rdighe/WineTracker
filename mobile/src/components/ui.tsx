/**
 * "Cellar Noir": the app's look. Near-black aubergine ground, frosted panels
 * with hairline borders, one luminous claret accent for actions and champagne
 * for money. Sora for the interface, JetBrains Mono for vintages and prices.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const colors = {
  bg: '#0D0A0E',
  surface: '#17131A',
  surface2: '#211B25',
  raised: '#2A2230',
  line: '#2E2733',
  line2: '#3A3140',
  text: '#F3EEF2',
  text2: '#CFC6D0',
  muted: '#A79CA8',
  faint: '#6F6573',
  accent: '#E8507E',
  onAccent: '#0D0A0E',
  gold: '#E7C27D',
  error: '#FF8FA8',
};

export const fonts = {
  light: 'Sora_300Light',
  regular: 'Sora_400Regular',
  medium: 'Sora_500Medium',
  semibold: 'Sora_600SemiBold',
  bold: 'Sora_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
};

/** Padding for a full screen under the floating tab bar (or none, for pushed screens). */
export function useScreenPadding(opts: { tabBar?: boolean } = {}): ViewStyle {
  const insets = useSafeAreaInsets();
  return { paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: opts.tabBar === false ? insets.bottom + 24 : 120, gap: 16 };
}

export function Screen({ children, tabBar, ...rest }: ScrollViewProps & { children: ReactNode; tabBar?: boolean }) {
  const padding = useScreenPadding({ tabBar });
  return (
    <ScrollView style={styles.screen} contentContainerStyle={padding} keyboardShouldPersistTaps="handled" {...rest}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Small uppercase label above a value or section. */
export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

/** Monospaced figures: vintages, prices, codes. */
export function Mono({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Text style={styles.error}>{error instanceof Error ? error.message : String(error)}</Text>;
}

export function Button({ title, onPress, disabled, variant = 'primary', busy, style }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'pill'; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        variant === 'pill' ? styles.pill : styles.button,
        primary ? styles.primary : variant === 'pill' ? styles.pillOutline : styles.secondary,
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={primary ? styles.primaryText : variant === 'pill' ? styles.pillText : styles.secondaryText}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Square icon button (back, save, photos). */
export function IconButton({ label, onPress, children, size = 40 }: { label: string; onPress: () => void; children: ReactNode; size?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { width: size, height: size, borderRadius: size >= 50 ? 16 : 14 }, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

export function Chip({ children, tone = 'plain', onPress }: { children: ReactNode; tone?: 'plain' | 'gold' | 'tag'; onPress?: () => void }) {
  const style = [styles.chip, tone === 'gold' && { borderColor: colors.gold }, tone === 'tag' && styles.tag];
  const text = <Text style={[tone === 'tag' ? styles.tagText : styles.chipText, tone === 'gold' && { color: colors.gold }]}>{children}</Text>;
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={style}>{text}</Pressable>
  ) : (
    <View style={style}>{text}</View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, small }: {
  options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <View accessibilityRole="radiogroup" style={[styles.segmented, small && { borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.line }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, small && { height: 32, paddingHorizontal: 10, borderRadius: 9 }, on && { backgroundColor: colors.raised }]}
          >
            <Text style={[styles.segmentText, small && { fontSize: 11 }, on && { color: colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, mono, style, ...rest }: TextInputProps & { label: string; mono?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput placeholderTextColor={colors.faint} style={[styles.input, mono && { fontFamily: fonts.mono }, style]} accessibilityLabel={label} {...rest} />
    </View>
  );
}

/** Five dots, in half steps: tap once for a full dot, again for a half. */
export function RatingDots({ value, onChange, size = 22 }: { value: number | null; onChange?: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value == null ? 0 : value >= n ? 1 : value >= n - 0.5 ? 0.5 : 0;
        const dot = (
          <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: fill ? colors.accent : colors.line2, overflow: 'hidden' }}>
            {fill ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fill === 1 ? '100%' : '50%', backgroundColor: colors.accent }} /> : null}
          </View>
        );
        return onChange ? (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Rate ${n}`} hitSlop={4} onPress={() => onChange(value === n ? n - 0.5 : n)}>
            {dot}
          </Pressable>
        ) : (
          <View key={n}>{dot}</View>
        );
      })}
      {value != null ? <Mono style={{ marginLeft: 6, fontSize: 14, color: colors.text }}>{value}</Mono> : null}
    </View>
  );
}

export const glow = {
  shadowColor: colors.accent,
  shadowOpacity: 0.35,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 0 },
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 18, borderWidth: 1, borderColor: colors.line, gap: 12 },
  title: { fontFamily: fonts.semibold, fontSize: 30, letterSpacing: -0.6, color: colors.text },
  h2: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  eyebrow: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.muted },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  mono: { fontFamily: fonts.mono, fontSize: 13, color: colors.text2 },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.error },
  input: {
    height: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.bg,
    paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 16, color: colors.text,
  },
  button: { height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: colors.accent, ...glow, shadowOpacity: 0.3 },
  secondary: { borderWidth: 1, borderColor: colors.line, backgroundColor: 'transparent' },
  primaryText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.onAccent },
  secondaryText: { fontFamily: fonts.regular, fontSize: 14, color: colors.text2 },
  pill: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, minHeight: 30, justifyContent: 'center' },
  pillOutline: { borderWidth: 1, borderColor: colors.accent },
  pillText: { fontFamily: fonts.regular, fontSize: 12, color: colors.text },
  iconButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line2 },
  chipText: { fontFamily: fonts.mono, fontSize: 12, color: colors.text2 },
  tag: { borderRadius: 999, backgroundColor: colors.surface2, paddingHorizontal: 12, paddingVertical: 7 },
  tagText: { fontFamily: fonts.regular, fontSize: 12, color: colors.text },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line2 },
  segment: { height: 38, paddingHorizontal: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
