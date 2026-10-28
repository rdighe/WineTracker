/**
 * Shared UI built on the WineTracker design system (components/theme.tsx):
 * warm neutral surfaces, one wine accent for actions and selection, the
 * system font with a serif for wine names, tabular figures for prices, and
 * liquid glass only for controls that float over content.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';
import { Glass, lift } from './Glass';
import { radius, size, space, type, useTheme, type Palette, type WineStyle } from './theme';

export { type, space, radius, size, useTheme, wineStyleOf } from './theme';

/** Styles that depend on the theme, for places that need a plain style object. */
export function useStyles() {
  const { c } = useTheme();
  return useMemo(() => makeStyles(c), [c]);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    input: {
      minHeight: size.controlMd, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', backgroundColor: c.surfaceSunken,
      paddingHorizontal: space[3], ...type.body, color: c.ink,
    },
    inputFocus: { borderColor: c.focus },
    headline: { ...type.headline, color: c.ink },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.hairline },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  });

/** Padding for a full screen under the floating tab bar (or none, for pushed screens). */
export function useScreenPadding(opts: { tabBar?: boolean } = {}): ViewStyle {
  const insets = useSafeAreaInsets();
  return { paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: opts.tabBar === false ? insets.bottom + space[6] : 120, gap: space[5] };
}

/** A scrolling screen that keeps the focused text field above the keyboard. */
export function Screen({ children, tabBar, contentContainerStyle, ...rest }: ScrollViewProps & { children: ReactNode; tabBar?: boolean }) {
  const { c } = useTheme();
  const padding = useScreenPadding({ tabBar });
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[padding, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={24}
      {...rest}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/** Grouped content on a solid surface. `flush` for lists of rows that run edge to edge. */
export function Card({ children, style, flush }: { children: ReactNode; style?: StyleProp<ViewStyle>; flush?: boolean }) {
  const { c, scheme } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
        flush ? { overflow: 'hidden' } : { padding: space[4], gap: space[3] },
        lift(scheme, 'card'),
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A section or field label: sentence case, never all caps. */
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text style={[type.footnote, { fontWeight: '600', color: c.ink2 }, style]}>{children}</Text>;
}

/** Card title. */
export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text style={[type.headline, { color: c.ink }, style]}>{children}</Text>;
}

/** Large title at the top of a tab. */
export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={[type.largeTitle, { color: c.ink }, style]}>{children}</Text>;
}

/** Supporting text: metadata, hints, explanations. */
export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const { c } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[type.footnote, { color: c.ink2 }, style]}>{children}</Text>;
}

/** Figures that should line up: prices, vintages, counts. */
export function Num({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Text style={[type.subhead, type.tabular, { color: c.ink }, style]}>{children}</Text>;
}

export function ErrorText({ error }: { error: unknown }) {
  const { c } = useTheme();
  if (!error) return null;
  return <Text accessibilityRole="alert" style={[type.footnote, { color: c.negative }]}>{error instanceof Error ? error.message : String(error)}</Text>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A springy press: the control dips slightly while held and bounces back. Off with Reduce Motion. */
function usePressScale(to = 0.96) {
  const { reduceMotion } = useTheme();
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return {
    style,
    onPressIn: () => {
      if (!reduceMotion) s.set(withSpring(to, { damping: 20, stiffness: 420 }));
    },
    onPressOut: () => {
      s.set(withSpring(1, { damping: 12, stiffness: 300 }));
    },
  };
}

export type ButtonVariant = 'primary' | 'tinted' | 'secondary' | 'plain';

/**
 * Pill button. primary: the one action a screen exists for. tinted: important
 * but secondary. secondary: neutral. plain: inline text action.
 */
export function Button({ title, onPress, disabled, variant = 'primary', size: s = 'lg', busy, icon, style, accessibilityLabel }: {
  title?: string; onPress: () => void; disabled?: boolean; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; busy?: boolean;
  icon?: (color: string) => ReactNode; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const press = usePressScale();
  const bg = { primary: c.accent, tinted: c.accentSoft, secondary: c.fillQuiet, plain: 'transparent' }[variant];
  const fg = { primary: c.onAccent, tinted: c.onAccentSoft, secondary: c.ink, plain: c.accent }[variant];
  const h = s === 'lg' ? size.controlLg : s === 'md' ? size.controlMd : size.controlSm;
  const iconOnly = icon && !title;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled || busy}
      hitSlop={s === 'sm' ? 5 : 0}
      style={[
        {
          height: h, minWidth: h, borderRadius: radius.pill, backgroundColor: bg, flexDirection: 'row', gap: space[2],
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: iconOnly ? 0 : s === 'sm' ? space[3] : space[5],
          alignSelf: s === 'lg' ? 'stretch' : 'flex-start',
        },
        disabled && { opacity: 0.45 },
        style,
        press.style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? icon(fg) : null}
          {title ? <Text style={[s === 'sm' ? type.footnote : s === 'md' ? type.subhead : type.headline, { fontWeight: '600', color: fg }]}>{title}</Text> : null}
        </>
      )}
    </AnimatedPressable>
  );
}

/** Round icon button. `glass` when it floats over content or a photo. */
export function IconButton({ label, onPress, children, glass, size: d = size.tapMin }: { label: string; onPress: () => void; children: ReactNode; glass?: boolean; size?: number }) {
  const { c } = useTheme();
  const body = <View style={{ width: d, height: d, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {glass ? <Glass interactive style={{ borderRadius: d / 2 }}>{body}</Glass> : <View style={{ borderRadius: d / 2, backgroundColor: c.fillQuiet }}>{body}</View>}
    </Pressable>
  );
}

/** Filter or choice pill. Selected fills with the accent. */
export function Chip({ children, selected, onPress, dot, small }: { children: ReactNode; selected?: boolean; onPress?: () => void; dot?: WineStyle; small?: boolean }) {
  const { c } = useTheme();
  const press = usePressScale(0.94);
  const inner = (
    <>
      {dot ? <StyleDot wineStyle={dot} ring={selected ? c.onAccent : undefined} /> : null}
      <Text style={[small ? type.footnote : type.subhead, { fontWeight: '500', color: selected ? c.onAccent : c.ink }]}>{children}</Text>
    </>
  );
  const style: ViewStyle = {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: small ? 30 : size.controlSm, paddingHorizontal: small ? 10 : space[3],
    borderRadius: radius.pill, backgroundColor: selected ? c.accent : c.fillQuiet,
  };
  return onPress ? (
    <AnimatedPressable accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} hitSlop={5} style={[style, press.style]}>
      {inner}
    </AnimatedPressable>
  ) : (
    <View style={style}>{inner}</View>
  );
}

/**
 * Two to four mutually exclusive views of the same content. The selected
 * thumb slides between options. `tinted`: the wine accent, for a switch
 * between two lists (Cellar / Tasted) rather than a sort.
 */
export function Segmented<T extends string>({ options, value, onChange, small, tinted }: {
  options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean; tinted?: boolean;
}) {
  const { c, scheme, reduceMotion } = useTheme();
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const target = layouts[value];
  useEffect(() => {
    if (!target) return;
    const first = w.value === 0;
    const go = (v: number) => (first || reduceMotion ? withTiming(v, { duration: first ? 0 : 120 }) : withSpring(v, { damping: 22, stiffness: 260, mass: 0.7 }));
    x.value = go(target.x);
    w.value = go(target.width);
  }, [target, reduceMotion, x, w]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value, opacity: w.value ? 1 : 0 }));
  const onText = tinted ? c.onAccent : c.ink;
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: radius.pill, backgroundColor: c.fillQuiet }}>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 0, top: 3, bottom: 3, borderRadius: radius.pill, backgroundColor: tinted ? c.accent : c.surfaceRaised }, tinted ? null : lift(scheme, 'card'), thumb]}
      />
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            onLayout={(e) => {
              const { x: lx, width } = e.nativeEvent.layout;
              setLayouts((l) => (l[o.key]?.x === lx && l[o.key]?.width === width ? l : { ...l, [o.key]: { x: lx, width } }));
            }}
            style={{ flexGrow: small ? 0 : 1, height: small ? 28 : 34, paddingHorizontal: small ? space[3] : space[4], borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[small ? type.footnote : type.subhead, { fontWeight: on ? '600' : '500', color: on ? onText : c.ink2 }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Labelled text input; the label stays visible above it. */
export function Field({ label, numeric, style, onFocus, onBlur, ...rest }: TextInputProps & { label: string; numeric?: boolean }) {
  const { c, scheme } = useTheme();
  const s = useStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={c.ink3}
        keyboardAppearance={scheme}
        selectionColor={c.accent}
        style={[s.input, focused && s.inputFocus, numeric && type.tabular, style]}
        accessibilityLabel={label}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        {...rest}
      />
    </View>
  );
}

/** A wine style's color dot; say the style in words nearby. */
export function StyleDot({ wineStyle, size: d = 10, ring }: { wineStyle: WineStyle; size?: number; ring?: string }) {
  const { c } = useTheme();
  return <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: c.style[wineStyle], borderWidth: ring ? 1.5 : 0, borderColor: ring }} />;
}

const STAR = 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z';

function Star({ fill, d, id }: { fill: 0 | 0.5 | 1; d: number; id: string }) {
  const { c } = useTheme();
  return (
    <Svg width={d} height={d} viewBox="0 0 24 24">
      <Defs>
        <ClipPath id={id}><Rect x="0" y="0" width="12" height="24" /></ClipPath>
      </Defs>
      <Path d={STAR} fill="none" stroke={fill ? c.accent : c.borderControl} strokeWidth={1.6} strokeLinejoin="round" />
      {fill ? <Path d={STAR} fill={c.accent} stroke={c.accent} strokeWidth={1.6} strokeLinejoin="round" clipPath={fill === 0.5 ? `url(#${id})` : undefined} /> : null}
    </Svg>
  );
}

/**
 * Five stars in half steps. As an input, the left half of a star gives n - 0.5
 * and the right half n.
 */
export function Rating({ value, onChange, size: s = 'sm', showValue }: { value: number | null; onChange?: (v: number) => void; size?: 'sm' | 'md' | 'lg'; showValue?: boolean }) {
  const { c } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const d = s === 'lg' ? 30 : s === 'md' ? 20 : 14;
  return (
    <View
      accessible={!onChange}
      accessibilityRole={onChange ? undefined : 'image'}
      accessibilityLabel={onChange ? undefined : value == null ? 'Not rated' : `Rated ${value} of 5`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: onChange ? space[1] : 1 }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value == null ? 0 : value >= n ? 1 : value >= n - 0.5 ? 0.5 : 0;
        const star = <Star fill={fill} d={d} id={`h${id}${n}`} />;
        return onChange ? (
          <View key={n} style={{ width: d, height: d }}>
            {star}
            <Pressable accessibilityRole="button" accessibilityLabel={`Rate ${n - 0.5}`} hitSlop={{ top: 8, bottom: 8, left: 2 }} onPress={() => onChange(n - 0.5)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: d / 2 }} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Rate ${n}`} hitSlop={{ top: 8, bottom: 8, right: 2 }} onPress={() => onChange(n)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: d / 2 }} />
          </View>
        ) : (
          <View key={n}>{star}</View>
        );
      })}
      {showValue && value != null ? <Text style={[type.footnote, type.tabular, { marginLeft: 6, fontWeight: '600', color: c.ink2 }]}>{value}</Text> : null}
    </View>
  );
}

/** Market now against what was paid: up in positive with ▲, down in negative with ▼, never color alone. */
export function PriceDelta({ paid, now, change, percentOnly }: {
  paid?: number | null; now?: number | null; percentOnly?: boolean;
  /** A ready-made fractional change (0.26 = +26%) instead of paid and now; shown as a percentage. */
  change?: number | null;
}) {
  const { c } = useTheme();
  if (change != null) {
    percentOnly = true;
    paid = 10000;
    now = Math.round(10000 * (1 + change));
  }
  if (!paid || !now) return null;
  const d = now - paid;
  const pct = Math.round((d / paid) * 100);
  if (pct === 0) return <Text style={[type.footnote, { fontWeight: '600', color: c.ink2 }]}>No change</Text>;
  const up = d > 0;
  const amount = `$${Math.round(Math.abs(d) / 100).toLocaleString('en-US')}`;
  return (
    <Text
      accessibilityLabel={`${up ? 'Up' : 'Down'} ${amount}, ${Math.abs(pct)} percent ${up ? 'more' : 'less'} than you paid`}
      style={[type.footnote, type.tabular, { fontWeight: '600', color: up ? c.positive : c.negative }]}
    >
      <Text style={{ fontSize: 9 }}>{up ? '▲ ' : '▼ '}</Text>
      {percentOnly ? `${up ? '+' : '−'}${Math.abs(pct)}%` : `${up ? '+' : '−'}${amount}  ${up ? '+' : '−'}${Math.abs(pct)}%`}
    </Text>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.divider, style]} />;
}
