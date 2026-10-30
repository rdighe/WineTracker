/** A pushed screen's top: back, then its title and a line under it. */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { BackIcon } from './icons';
import { IconButton, Muted, Title, space, useTheme } from './ui';

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ marginLeft: -space[2], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <BackIcon color={c.ink} size={20} />
        </IconButton>
        {right}
      </View>
      <View>
        <Title>{title}</Title>
        {subtitle ? <Muted style={{ marginTop: 2 }}>{subtitle}</Muted> : null}
      </View>
    </View>
  );
}
