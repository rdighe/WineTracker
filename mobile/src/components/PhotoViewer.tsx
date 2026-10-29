/**
 * A list's or shelf's photos full screen, over everything: swipe between
 * them, pinch (or double-tap) to zoom in, × to close.
 */
import type { ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PickPhoto } from './PickPhoto';
import { IconButton, space, type } from './ui';

/** A photo on the phone, or one saved with a list. */
export type ViewedPhoto = { uri: string } | { pickId: number; n: number };

export function PhotoViewer({ photos, index, onClose }: { photos: ViewedPhoto[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (index === null) return null;
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: index * width, y: 0 }}
        >
          {photos.map((p, i) => (
            <ScrollView
              key={'uri' in p ? `${p.uri}-${i}` : `${p.pickId}-${p.n}`}
              style={{ width, height }}
              contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              {'uri' in p ? (
                <Image source={{ uri: p.uri }} style={{ width, height }} resizeMode="contain" accessibilityLabel={`Photo ${i + 1}`} />
              ) : (
                <PickPhoto pickId={p.pickId} n={p.n} style={{ width, height, backgroundColor: '#000' }} fit="contain" />
              )}
            </ScrollView>
          ))}
        </ScrollView>
        <View style={{ position: 'absolute', top: insets.top + space[2], left: space[3], right: space[3], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[type.footnote, { color: '#fff', opacity: photos.length > 1 ? 0.8 : 0 }]}>
            {photos.length > 1 ? `${photos.length} photos · swipe` : ''}
          </Text>
          <IconButton label="Close photo" onPress={onClose} size={36}>
            <Text style={[type.headline, { color: '#fff', lineHeight: 20 }]}>×</Text>
          </IconButton>
        </View>
      </View>
    </Modal>
  );
}

/** A thumbnail that opens the viewer. */
export function PhotoThumb({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label} accessibilityHint="Opens the photo full screen" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {children}
    </Pressable>
  );
}
