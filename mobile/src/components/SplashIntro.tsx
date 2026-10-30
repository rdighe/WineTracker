/**
 * The opening animation, white on black: "WineTracker" typed out in
 * foodscape.wine's DOS face, a letter at a time behind a blinking block
 * cursor, then a short dive into the app - the name rushes toward you, faint
 * rings fall away like the walls of a tunnel, and a hole opens from the
 * centre onto the app as it settles into place (appIn, driven here and drawn
 * by the root layout). The native splash (also black) hands over to it, so
 * there's no flash. Tap to skip; with Reduce Motion the name simply appears
 * and the app fades in.
 */
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { WORDMARK_FONT, useTheme, wordmarkFont } from './theme';

const NAME = 'WineTracker';
const INK = '#ffffff';
const GROUND = '#000000';
/** As foodscape.wine's boot: a letter every 70 ms. */
const TYPE_MS = 70;
const TYPE_DELAY_MS = 180;
/** The cursor blinks over the finished name this long before the dive. */
const HOLD_MS = 560;
const BLINK_MS = 260;
const DIVE_MS = 720;
/** Three tunnel rings, a beat apart. */
const RINGS = [0, 90, 180];
/** 3x the font's 16 px grid, so the pixels stay square. */
const SIZE = 48;

export function SplashIntro({ onDone, appIn }: { onDone: () => void; appIn: SharedValue<number> }) {
  const { reduceMotion } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const diag = Math.hypot(W, H);
  const [fontsReady] = useFonts({ [WORDMARK_FONT]: require('../../assets/fonts/PerfectDOSVGA437.ttf') });
  const [textW, setTextW] = useState(0);
  const [typed, setTyped] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const dive = useSharedValue(0);

  // Typing, then the blinking cursor, then the dive; once the face is in and the name measured.
  useEffect(() => {
    if (!fontsReady || !textW) return;
    void SplashScreen.hideAsync();
    const finish = (done?: boolean) => {
      'worklet';
      if (done) scheduleOnRN(onDone);
    };
    if (reduceMotion) {
      appIn.set(withDelay(700, withTiming(1, { duration: 300 })));
      dive.set(withDelay(700, withTiming(1, { duration: 300 }, finish)));
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= NAME.length; i++) timers.push(setTimeout(() => setTyped(i), TYPE_DELAY_MS + i * TYPE_MS));
    const typedAt = TYPE_DELAY_MS + NAME.length * TYPE_MS;
    const blink = setInterval(() => setCursorOn((on) => !on), BLINK_MS);
    const ease = Easing.bezier(0.55, 0, 0.75, 0.25);
    dive.set(withDelay(typedAt + HOLD_MS, withTiming(1, { duration: DIVE_MS, easing: ease }, finish)));
    appIn.set(withDelay(typedAt + HOLD_MS + DIVE_MS * 0.3, withTiming(1, { duration: DIVE_MS * 0.7, easing: Easing.out(Easing.cubic) })));
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(blink);
    };
  }, [fontsReady, textW, reduceMotion, dive, appIn, onDone]);

  // The name rushes toward the viewer and is gone before the hole reaches it.
  const name = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 - dive.value : 1 - Math.min(1, dive.value * 1.6),
    transform: [{ scale: reduceMotion ? 1 : 1 + 2.2 * dive.value * dive.value }],
  }));
  // The black ground with a round hole at its centre, opening onto the app.
  const hole = useAnimatedStyle(() => {
    const d = reduceMotion ? 0 : Math.max(0, (dive.value - 0.25) / 0.75) * (diag + 8);
    const outer = d + 2 * diag;
    return { width: outer, height: outer, borderRadius: outer / 2, borderWidth: diag, left: W / 2 - outer / 2, top: H / 2 - outer / 2, opacity: reduceMotion ? 1 - dive.value : 1 };
  });

  const label = (
    <Text style={[wordmarkFont, { fontSize: SIZE, lineHeight: SIZE + 8, color: INK }]} numberOfLines={1} allowFontScaling={false}>
      {NAME}
    </Text>
  );
  const charW = textW / NAME.length;
  // With Reduce Motion the name is simply there.
  const shown = reduceMotion ? NAME.length : typed;

  return (
    <Pressable
      accessibilityLabel="WineTracker. Tap to skip."
      onPress={onDone}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 100 }}
    >
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderColor: GROUND }, hole]} />
      {RINGS.map((delay) => (
        <Ring key={delay} dive={dive} delay={delay} diag={diag} W={W} H={H} hidden={reduceMotion} />
      ))}
      {fontsReady ? (
        <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {/* Measured once, invisibly, so the letters and the cursor have fixed places. */}
          <View style={{ position: 'absolute', opacity: 0 }} onLayout={(e) => setTextW(e.nativeEvent.layout.width)}>
            {label}
          </View>
          <Animated.View style={[{ width: textW, height: SIZE + 8, flexDirection: 'row', alignItems: 'center' }, name]}>
            <Text style={[wordmarkFont, { fontSize: SIZE, lineHeight: SIZE + 8, color: INK }]} numberOfLines={1} allowFontScaling={false}>
              {NAME.slice(0, shown)}
            </Text>
            {cursorOn && !reduceMotion ? (
              <View style={{ position: 'absolute', left: shown * charW, width: charW, height: SIZE * 0.9, backgroundColor: INK }} />
            ) : null}
          </Animated.View>
        </View>
      ) : null}
    </Pressable>
  );
}

/** A faint ring falling away as the tunnel opens. */
function Ring({ dive, delay, diag, W, H, hidden }: { dive: SharedValue<number>; delay: number; diag: number; W: number; H: number; hidden: boolean }) {
  const style = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (dive.value * DIVE_MS - delay) / (DIVE_MS * 0.7)));
    const d = 24 + t * t * diag;
    return { width: d, height: d, borderRadius: d / 2, left: W / 2 - d / 2, top: H / 2 - d / 2, opacity: hidden || t === 0 ? 0 : 0.22 * (1 - t) };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderWidth: 1, borderColor: INK }, style]} />;
}
