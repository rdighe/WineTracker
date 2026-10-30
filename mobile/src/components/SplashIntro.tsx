/**
 * The opening animation, white on black: "WineTracker" typed out in
 * foodscape.wine's DOS face, a letter at a time behind a blinking block
 * cursor, then the black fades away onto the app. Only opacity animates (on
 * the UI thread), so it stays smooth while the app loads underneath. The
 * native splash (also black) hands over to it, so there's no flash. Tap to
 * skip; with Reduce Motion the name simply appears.
 */
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { WORDMARK_FONT, useTheme, wordmarkFont } from './theme';

const NAME = 'WineTracker';
const INK = '#ffffff';
const GROUND = '#000000';
/** As foodscape.wine's boot: a letter every 70 ms. */
const TYPE_MS = 70;
const TYPE_DELAY_MS = 180;
/** The cursor blinks over the finished name this long before the fade. */
const HOLD_MS = 560;
const BLINK_MS = 260;
const FADE_MS = 320;
/** 3x the font's 16 px grid, so the pixels stay square. */
const SIZE = 48;

export function SplashIntro({ onDone }: { onDone: () => void }) {
  const { reduceMotion } = useTheme();
  const [fontsReady] = useFonts({ [WORDMARK_FONT]: require('../../assets/fonts/PerfectDOSVGA437.ttf') });
  const [textW, setTextW] = useState(0);
  const [typed, setTyped] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const fade = useSharedValue(0);

  // Typing, then the blinking cursor, then the fade; once the face is in and the name measured.
  useEffect(() => {
    if (!fontsReady || !textW) return;
    void SplashScreen.hideAsync();
    const finish = (done?: boolean) => {
      'worklet';
      if (done) scheduleOnRN(onDone);
    };
    const typedAt = reduceMotion ? 0 : TYPE_DELAY_MS + NAME.length * TYPE_MS;
    fade.set(withDelay(typedAt + HOLD_MS, withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.quad) }, finish)));
    if (reduceMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= NAME.length; i++) timers.push(setTimeout(() => setTyped(i), TYPE_DELAY_MS + i * TYPE_MS));
    const blink = setInterval(() => setCursorOn((on) => !on), BLINK_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(blink);
    };
  }, [fontsReady, textW, reduceMotion, fade, onDone]);

  const overlay = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));

  const label = (
    <Text style={[wordmarkFont, { fontSize: SIZE, lineHeight: SIZE + 8, color: INK }]} numberOfLines={1} allowFontScaling={false}>
      {NAME}
    </Text>
  );
  const charW = textW / NAME.length;
  // With Reduce Motion the name is simply there.
  const shown = reduceMotion ? NAME.length : typed;

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: GROUND }, overlay]}>
      <Pressable accessibilityLabel="WineTracker. Tap to skip." onPress={onDone} style={{ flex: 1 }}>
        {fontsReady ? (
          <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {/* Measured once, invisibly, so the letters and the cursor have fixed places. */}
            <View style={{ position: 'absolute', opacity: 0 }} onLayout={(e) => setTextW(e.nativeEvent.layout.width)}>
              {label}
            </View>
            <View style={{ width: textW, height: SIZE + 8, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[wordmarkFont, { fontSize: SIZE, lineHeight: SIZE + 8, color: INK }]} numberOfLines={1} allowFontScaling={false}>
                {NAME.slice(0, shown)}
              </Text>
              {cursorOn && !reduceMotion ? (
                <View style={{ position: 'absolute', left: shown * charW, width: charW, height: SIZE * 0.9, backgroundColor: INK }} />
              ) : null}
            </View>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
