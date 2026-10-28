/**
 * Loading placeholders: the shape of the page in grey blocks that pulse
 * together until the content arrives. Still when the phone asks for reduced
 * motion.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { Card, useTheme } from './ui';

const Pulse = createContext<Animated.Value | null>(null);

/** Wrap a set of Bones so they pulse in step. */
export function Skeleton({ children, label = 'Loading' }: { children: ReactNode; label?: string }) {
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.45, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);
  return (
    <Pulse.Provider value={pulse}>
      <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={{ gap: 16 }}>
        {children}
      </View>
    </Pulse.Provider>
  );
}

/** One placeholder block. */
export function Bone({ width = '100%', height = 12, radius = 6, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useContext(Pulse);
  const { c } = useTheme();
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: c.fillQuiet, opacity: pulse ?? 1 }, style]} />;
}

/** Lines of text still loading: full width, then shorter. */
export function TextBones({ lines = 3, height = 12 }: { lines?: number; height?: number }) {
  const widths: DimensionValue[] = ['100%', '94%', '86%', '97%', '62%'];
  return (
    <View style={{ gap: 8 }}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} height={height} width={i === lines - 1 ? '58%' : widths[i % widths.length]} />
      ))}
    </View>
  );
}

/** The price card while prices load. */
export function PriceBones() {
  return (
    <>
      <Bone width={150} height={34} radius={8} />
      <Bone height={8} radius={4} style={{ marginTop: 4 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Bone width={70} height={10} />
        <Bone width={70} height={10} />
      </View>
    </>
  );
}

/** The wine page before anything has loaded: photo, name, price, vintages, background. */
export function WineSkeleton() {
  const bars: DimensionValue[] = ['82%', '64%', '91%', '55%', '73%'];
  return (
    <Skeleton label="Loading wine">
      <Bone height={300} radius={16} />
      <View style={{ gap: 10 }}>
        <Bone width="85%" height={28} radius={8} />
        <Bone width="55%" height={28} radius={8} />
        <Bone width={180} height={12} />
      </View>
      <Card style={{ gap: 10 }}>
        <Bone width={90} height={12} />
        <PriceBones />
      </Card>
      <Card style={{ gap: 12 }}>
        <Bone width={80} height={12} />
        {bars.map((w, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Bone width={44} height={12} />
            <View style={{ flex: 1 }}>
              <Bone width={w} height={8} radius={4} />
            </View>
            <Bone width={60} height={12} />
          </View>
        ))}
      </Card>
      <Card style={{ gap: 14 }}>
        <Bone width={120} height={12} />
        <TextBones lines={4} height={13} />
      </Card>
    </Skeleton>
  );
}
