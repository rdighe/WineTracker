/**
 * The opening animation: "WineTracker" written out in Snell Roundhand, as if
 * by pen, then a short underline, then the app fades in underneath. The native
 * splash (same background) hands over to it, so there's no flash. Tap to skip;
 * with Reduce Motion the name simply fades in.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { scriptFont, useTheme } from './theme';

const WRITE_MS = 1500;
const HOLD_MS = 450;
const FADE_MS = 380;

export function SplashIntro({ onDone }: { onDone: () => void }) {
  const { c, reduceMotion } = useTheme();
  const [textW, setTextW] = useState(0);
  const write = useSharedValue(0);
  const line = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (!textW) return;
    void SplashScreen.hideAsync();
    const finish = (done?: boolean) => {
      'worklet';
      if (done) scheduleOnRN(onDone);
    };
    if (reduceMotion) {
      write.value = withTiming(1, { duration: 400 });
      line.value = 1;
      fade.value = withDelay(400 + HOLD_MS, withTiming(0, { duration: FADE_MS }, finish));
      return;
    }
    write.value = withTiming(1, { duration: WRITE_MS, easing: Easing.bezier(0.45, 0.05, 0.35, 1) });
    line.value = withDelay(WRITE_MS - 250, withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }));
    fade.value = withSequence(withDelay(WRITE_MS + HOLD_MS, withTiming(0, { duration: FADE_MS }, finish)));
  }, [textW, reduceMotion, write, line, fade, onDone]);

  const reveal = useAnimatedStyle(() => (reduceMotion ? { width: textW, opacity: write.value } : { width: textW * write.value + 2 }));
  const underline = useAnimatedStyle(() => ({ width: textW * 0.42 * line.value, opacity: line.value }));
  const overlay = useAnimatedStyle(() => ({ opacity: fade.value }));
  const name = <Text style={[scriptFont, { fontSize: 58, lineHeight: 92, color: c.accent, paddingHorizontal: 12 }]} numberOfLines={1}>WineTracker</Text>;

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: c.bg, zIndex: 100 }, overlay]}>
      <Pressable accessibilityLabel="WineTracker. Tap to skip." onPress={onDone} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {/* Measured once, invisibly, so the pen knows how far to write. */}
        <View style={{ position: 'absolute', opacity: 0 }} pointerEvents="none" onLayout={(e) => setTextW(e.nativeEvent.layout.width)}>
          {name}
        </View>
        <Animated.View style={[{ overflow: 'hidden', height: 92 }, reveal]}>
          <View style={{ width: textW }}>{name}</View>
        </Animated.View>
        <Animated.View style={[{ height: 1.5, borderRadius: 1, backgroundColor: c.accent, marginTop: 2 }, underline]} />
      </Pressable>
    </Animated.View>
  );
}
