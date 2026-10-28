import { Redirect, Tabs, router } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddMenu } from '../../components/AddMenu';
import { Glass } from '../../components/Glass';
import { BottleIcon, GearIcon, ListIcon, PlusIcon, SparkleIcon } from '../../components/icons';
import { radius, space, type, useTheme } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { pendingScan } from '../../lib/pendingScan';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  index: SparkleIcon,
  lists: ListIcon,
  wines: BottleIcon,
  settings: GearIcon,
};
/** The + button beside the tab bar: a glass circle as tall as the bar. */
const PLUS = 62;
/** Widest a tab gets; narrower when the tabs and the + button wouldn't fit the screen. */
const TAB_MAX = 78;
const PAD = 4;

/**
 * Liquid-glass capsule floating over the content (the selected tab's
 * highlight slides between tabs), and beside it a separate + button that opens
 * the ways to add a wine.
 */
function GlassTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { c, reduceMotion } = useTheme();
  const [menu, setMenu] = useState<{ closing: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu((m) => (m ? { closing: true } : m)), []);
  const menuClosed = useCallback(() => setMenu(null), []);
  const bottom = Math.max(insets.bottom - 6, space[3]);
  const { width } = useWindowDimensions();
  const tabW = Math.min(TAB_MAX, Math.floor((width - 2 * space[4] - space[3] - PLUS - 2 * PAD) / state.routes.length));
  const x = useSharedValue(state.index * tabW);
  useEffect(() => {
    x.value = reduceMotion ? withTiming(state.index * tabW, { duration: 120 }) : withSpring(state.index * tabW, { damping: 20, stiffness: 260, mass: 0.8 });
  }, [state.index, reduceMotion, x, tabW]);
  const highlight = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: space[4], right: space[4], bottom, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space[3] }}>
      <Glass style={{ borderRadius: radius.xl }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: PAD }}>
          <Animated.View style={[{ position: 'absolute', left: PAD, top: PAD, width: tabW, height: 54, borderRadius: radius.xl, backgroundColor: c.glassSelected }, highlight]} />
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
                  { width: tabW, height: 54, paddingHorizontal: space[1], alignItems: 'center', justifyContent: 'center', gap: 2 },
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a wine"
        accessibilityState={{ expanded: Boolean(menu && !menu.closing) }}
        onPress={() => setMenu({ closing: false })}
        style={({ pressed }) => [pressed && !reduceMotion && { transform: [{ scale: 0.92 }] }]}
      >
        {/* The one tinted control on the glass layer: adding a wine is the app's main action. */}
        <Glass tint style={{ width: PLUS, height: PLUS, borderRadius: PLUS / 2 }}>
          <View style={{ width: PLUS, height: PLUS, alignItems: 'center', justifyContent: 'center' }}>
            <PlusIcon color={c.onAccent} size={28} />
          </View>
        </Glass>
      </Pressable>
      <AddMenu open={Boolean(menu)} closing={Boolean(menu?.closing)} onClosed={menuClosed} onRequestClose={closeMenu} bottom={bottom + PLUS + space[2]} right={space[4]} />
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
  return <SignedInTabs />;
}

function SignedInTabs() {
  const { c } = useTheme();
  // A scan started before the app was switched away or closed: open Add wine to finish it.
  useEffect(() => {
    void pendingScan().then((p) => p && router.push('/add'));
  }, []);
  return (
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'fade' }}>
      <Tabs.Screen name="index" options={{ title: 'For you' }} />
      <Tabs.Screen name="lists" options={{ title: 'Lists' }} />
      <Tabs.Screen name="wines" options={{ title: 'My wines' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
