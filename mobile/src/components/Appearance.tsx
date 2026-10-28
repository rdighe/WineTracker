/** Settings › Appearance: theme. */
import { View } from 'react-native';
import { Card, Heading, Label, Segmented, space, useTheme } from './ui';
import type { ThemePref } from './theme';

export function AppearanceSettings() {
  const { prefs, setPrefs } = useTheme();
  return (
    <Card>
      <Heading>Appearance</Heading>
      <View style={{ gap: space[2] }}>
        <Label>Theme</Label>
        <Segmented<ThemePref>
          options={[{ key: 'system', label: 'System' }, { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }]}
          value={prefs.theme}
          onChange={(theme) => setPrefs({ theme })}
        />
      </View>
    </Card>
  );
}
