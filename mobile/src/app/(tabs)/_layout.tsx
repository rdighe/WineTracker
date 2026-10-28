import { Redirect, Tabs } from 'expo-router';
import { useEffect, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../../components/Glass';
import { BottleIcon, GearIcon, PlusIcon, SparkleIcon } from '../../components/icons';
import { radius, space, type, useTheme } from '../../components/ui';
import { useAuth } from '../../lib/auth';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  index: PlusIcon,
  wines: BottleIcon,
  recommendations: SparkleIcon,
  settings: GearIcon,
};
const TAB_W = 78;
const PAD = 4;

/** Liquid-glass capsule floating over the content; the selected tab's highlight slides between tabs. */
function GlassTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { c, reduceMotion } = useTheme();
  const x = useSharedValue(state.index * TAB_W);
  useEffect(() => {
    x.value = reduceMotion ? withTiming(state.index * TAB_W, { duration: 120 }) : withSpring(state.index * TAB_W, { damping: 20, stiffness: 260, mass: 0.8 });
  }, [state.index, reduceMotion, x]);
  const highlight = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: space[4], right: space[4], bottom: Math.max(insets.bottom - 6, space[3]), alignItems: 'center' }}>
      <Glass style={{ borderRadius: radius.xl }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: PAD }}>
          <Animated.View style={[{ position: 'absolute', left: PAD, top: PAD, width: TAB_W, height: 54, borderRadius: radius.xl, backgroundColor: c.glassSelected }, highlight]} />
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const title = descriptors[route.key]?.options.title ?? route.name;
            const Icon = ICONS[route.name] ?? PlusIcon;
            const color = focused ? c.accent : c.ink;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={title}
                onPress={() => {
                  const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                }}
                style={({ pressed }) => [
                  { width: TAB_W, height: 54, paddingHorizontal: space[1], alignItems: 'center', justifyContent: 'center', gap: 2 },
                  pressed && !reduceMotion && { transform: [{ scale: 0.92 }] },
                ]}
              >
                <Icon color={color} size={24} />
                <Text style={[type.caption, { color }]} numberOfLines={1}>{title}</Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

export default function TabLayout() {
  const { ready, signedIn } = useAuth();
  const { c } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  if (!signedIn) return <Redirect href="/sign-in" />;
  return (
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'fade' }}>
      <Tabs.Screen name="index" options={{ title: 'Add wine' }} />
      <Tabs.Screen name="wines" options={{ title: 'My wines' }} />
      <Tabs.Screen name="recommendations" options={{ title: 'For you' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
