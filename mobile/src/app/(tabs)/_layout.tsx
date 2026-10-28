import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../../components/Glass';
import { BottleIcon, GlassIcon, PlusIcon, SparkleIcon } from '../../components/icons';
import { radius, space, type, useTheme } from '../../components/ui';
import { useAuth } from '../../lib/auth';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  index: PlusIcon,
  cellar: BottleIcon,
  tastings: GlassIcon,
  recommendations: SparkleIcon,
};

/** Liquid-glass capsule floating over the content, which scrolls underneath it. */
function GlassTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: space[4], right: space[4], bottom: Math.max(insets.bottom - 6, space[3]), alignItems: 'center' }}>
      <Glass style={{ borderRadius: radius.xl }}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4 }}>
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
                style={{
                  minWidth: 76, height: 54, paddingHorizontal: space[2], borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', gap: 2,
                  backgroundColor: focused ? c.glassSelected : 'transparent',
                }}
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
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Add wine' }} />
      <Tabs.Screen name="cellar" options={{ title: 'Cellar' }} />
      <Tabs.Screen name="tastings" options={{ title: 'Tastings' }} />
      <Tabs.Screen name="recommendations" options={{ title: 'For you' }} />
    </Tabs>
  );
}
