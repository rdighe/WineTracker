/** Your initial in a circle at the top right of each tab: opens You › Settings (appearance, location, account, import, the tour). */
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useAuth } from '../lib/auth';
import { type, useTheme } from './ui';

export function ProfileButton() {
  const { label } = useAuth();
  const { c, reduceMotion } = useTheme();
  const initial = (label?.trim()[0] ?? '·').toUpperCase();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="You and Settings"
      onPress={() => router.push('/settings')}
      hitSlop={6}
      style={({ pressed }) => [
        { width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
        pressed && !reduceMotion && { transform: [{ scale: 0.92 }] },
      ]}
    >
      <Text style={[type.headline, { color: c.onAccent }]}>{initial}</Text>
    </Pressable>
  );
}
