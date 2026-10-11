import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Text, View, type ColorValue } from 'react-native';
import { useAuth } from '../../lib/auth';
import { colors } from '../../components/ui';

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}

export default function TabLayout() {
  const { ready, signedIn } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.wine} />
      </View>
    );
  }
  if (!signedIn) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.wine, headerTintColor: colors.text }}>
      <Tabs.Screen name="index" options={{ title: 'Scan', tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }} />
      <Tabs.Screen name="tastings" options={{ title: 'My wines', tabBarIcon: ({ color }) => <TabIcon glyph="♥" color={color} /> }} />
      <Tabs.Screen name="recommendations" options={{ title: 'For you', tabBarIcon: ({ color }) => <TabIcon glyph="✦" color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color }) => <TabIcon glyph="⌕" color={color} /> }} />
    </Tabs>
  );
}
