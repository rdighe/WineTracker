/** A wine's reference photo (a shop packshot on white), or a glass icon when there is none. */
import { useState } from 'react';
import { Image, View } from 'react-native';
import { GlassIcon } from './icons';
import { colors } from './ui';

export function WineThumb({ uri, width = 48, height = 64, radius = 12 }: { uri: string | null | undefined; width?: number; height?: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <View style={{ width, height, borderRadius: radius, backgroundColor: '#FFFFFF', overflow: 'hidden', padding: Math.round(width / 16) }}>
        <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View style={{ width, height, borderRadius: radius, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' }}>
      <GlassIcon color={colors.faint} size={Math.round(Math.min(width, height) / 2.4)} />
    </View>
  );
}
