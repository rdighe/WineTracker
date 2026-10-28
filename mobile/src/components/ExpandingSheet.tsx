/**
 * A sheet that grows out of the button that opened it (Log tasting, Add to
 * cellar) and shrinks back into it when closed. With Reduce Motion it fades
 * in place instead.
 */
import { useEffect, type ReactNode, type RefObject } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { lift } from './Glass';
import { radius, space, type, useTheme } from './theme';

export interface Rect { x: number; y: number; width: number; height: number }

/** Where a view is on screen, for the sheet to grow from. */
export function measure(ref: RefObject<View | null>): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!ref.current) return resolve(null);
    ref.current.measureInWindow((x, y, width, height) => resolve(width ? { x, y, width, height } : null));
  });
}

export function ExpandingSheet({ origin, label, tint, closing, onClosed, onRequestClose, title, children, overTabs }: {
  /** The button's rect; the sheet starts there. */
  origin: Rect;
  /** The button's label, shown as the shape grows so it reads as the same object. */
  label: string;
  /** The button was the tinted primary action (wine) rather than plain glass. */
  tint?: boolean;
  /** Set to start the close animation; onClosed fires when it ends. */
  closing: boolean;
  onClosed: () => void;
  onRequestClose: () => void;
  title: string;
  children: ReactNode;
  /** On a tab screen: draw above the tab bar (in a modal layer) rather than inside the screen. */
  overTabs?: boolean;
}) {
  const { c, reduceMotion, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const p = useSharedValue(0);
  const target = { x: space[2], y: insets.top + space[2], width: W - space[4], height: H - insets.top - space[2] };
  const from = reduceMotion ? target : origin;

  useEffect(() => {
    if (closing) {
      p.value = withTiming(0, { duration: reduceMotion ? 180 : 280, easing: Easing.inOut(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(onClosed);
      });
    } else {
      p.value = reduceMotion ? withTiming(1, { duration: 200 }) : withSpring(1, { damping: 24, stiffness: 210, mass: 0.9 });
    }
  }, [closing, reduceMotion, p, onClosed]);

  const startBg = tint ? c.accent : c.surfaceRaised;
  const shape = useAnimatedStyle(() => ({
    left: interpolate(p.value, [0, 1], [from.x, target.x]),
    top: interpolate(p.value, [0, 1], [from.y, target.y]),
    width: interpolate(p.value, [0, 1], [from.width, target.width]),
    height: interpolate(p.value, [0, 1], [from.height, target.height]),
    borderRadius: interpolate(p.value, [0, 1], [from.height / 2, radius.xl]),
    backgroundColor: interpolateColor(p.value, [0, 0.5], [startBg, c.bg]),
    opacity: reduceMotion ? p.value : 1,
  }));
  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  const buttonLabel = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.25], [1, 0], 'clamp') }));
  const content = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.45, 0.9], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(p.value, [0.45, 1], [12, 0], 'clamp') }],
  }));

  const sheet = (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 50 }}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: c.scrim }, scrim]}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onRequestClose} />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={[{ position: 'absolute', overflow: 'hidden' }, lift(scheme, 'pop'), shape]}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: origin.height, alignItems: 'center', justifyContent: 'center' }, buttonLabel]}>
          <Text style={[type.subhead, { fontWeight: '600', color: tint ? c.onAccent : c.ink }]}>{label}</Text>
        </Animated.View>
        <Animated.View style={[{ flex: 1 }, content]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2] }}>
            <Text accessibilityRole="header" style={[type.title2, { color: c.ink }]}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onRequestClose}
              hitSlop={8}
              style={({ pressed }) => [{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.fillQuiet, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[type.headline, { color: c.ink2, lineHeight: 20 }]}>×</Text>
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
  return overTabs ? (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onRequestClose}>
      {sheet}
    </Modal>
  ) : sheet;
}
