/** Settings › Appearance: theme and glass. The phone's accessibility settings always win over the glass choice. */
import { Platform, View } from 'react-native';
import { Card, Heading, Label, Muted, Segmented, space, useTheme } from './ui';
import type { GlassPref, ThemePref } from './theme';

export function AppearanceSettings() {
  const { prefs, setPrefs, glass } = useTheme();
  const overridden = glass === 'solid' && prefs.glass !== 'solid' ? 'Reduce Transparency is on, so glass is shown solid.'
    : glass === 'contrast' ? 'Increase Contrast is on, so glass is more frosted with a clear edge.'
    : null;
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
      <View style={{ gap: space[2] }}>
        <Label>Glass</Label>
        <Segmented<GlassPref>
          options={[{ key: 'device', label: 'Device' }, { key: 'clear', label: 'Clear' }, { key: 'tinted', label: 'Tinted' }, { key: 'solid', label: 'Solid' }]}
          value={prefs.glass}
          onChange={(g) => setPrefs({ glass: g })}
        />
        <Muted>
          {overridden ?? (Platform.OS === 'ios'
            ? 'Device follows Settings › Display & Brightness › Liquid Glass.'
            : 'Clear shows more of what’s behind the bars; Tinted is more frosted.')}
        </Muted>
      </View>
    </Card>
  );
}
