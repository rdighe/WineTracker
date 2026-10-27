import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottleIcon, GlassIcon, PlusIcon, SparkleIcon } from '../../components/icons';
import { colors, fonts } from '../../components/ui';
import { useAuth } from '../../lib/auth';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, (p: { color: string; size?: number }) => React.ReactElement> = {
  index: PlusIcon,
  cellar: BottleIcon,
  tastings: GlassIcon,
  recommendations: SparkleIcon,
};

/** Floating frosted pill, inset from the screen edges. */
function PillTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute', left: 20, right: 20, bottom: Math.max(insets.bottom - 8, 12) + 14, height: 64,
        borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
        flexDirection: 'row', alignItems: 'center',
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const title = descriptors[route.key]?.options.title ?? route.name;
        const Icon = ICONS[route.name] ?? PlusIcon;
        const color = focused ? colors.accent : colors.muted;
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
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, height: '100%' }}
          >
            <Icon color={color} />
            <Text style={{ fontFamily: focused ? fonts.semibold : fonts.regular, fontSize: 10, color }}>{title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { ready, signedIn } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!signedIn) return <Redirect href="/sign-in" />;
  return (
    <Tabs tabBar={(props) => <PillTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Add wine' }} />
      <Tabs.Screen name="cellar" options={{ title: 'My Cellar' }} />
      <Tabs.Screen name="tastings" options={{ title: 'My Tastings' }} />
      <Tabs.Screen name="recommendations" options={{ title: 'For you' }} />
    </Tabs>
  );
}
