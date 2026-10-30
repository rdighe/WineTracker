/**
 * The floating + button's menu: the ways to add a wine. It grows out of the
 * button (bottom right) and each choice opens Add wine already started that
 * way: the camera, a lineup photo, the photo library, or search / by hand;
 * or a wine list or shelf, ranked for the person (app/picks.tsx).
 */
import { router } from 'expo-router';
import { useEffect, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { lift } from './Glass';
import { BottleIcon, DocumentIcon, ListIcon, PhotosIcon, ScanIcon, SearchIcon } from './icons';
import { radius, space, type, useTheme } from './theme';

type Start = 'camera' | 'lineup' | 'receipt' | 'list' | 'library' | 'search';

type Choice = { key: Start; title: string; detail: string; Icon: (p: { color: string; size?: number }) => ReactElement };

/** Two groups: adding wines you have or bought, and choosing what to order or buy. */
const SECTIONS: { title: string; choices: Choice[] }[] = [
  {
    title: 'Add a wine',
    choices: [
      { key: 'camera', title: 'Scan a label', detail: 'Photograph the front label', Icon: ScanIcon },
      { key: 'lineup', title: 'Scan a lineup', detail: 'Several bottles in one photo', Icon: BottleIcon },
      { key: 'library', title: 'Choose a photo', detail: 'A label photo you already took', Icon: PhotosIcon },
      { key: 'search', title: 'Search or add by hand', detail: 'Type the producer or wine', Icon: SearchIcon },
      { key: 'receipt', title: 'Receipt or invoice', detail: 'Add the bottles you bought, at what they cost', Icon: DocumentIcon },
    ],
  },
  {
    title: 'Wine selection',
    choices: [{ key: 'list', title: 'Wine list or store shelf', detail: 'The best wines on it for your taste', Icon: ListIcon }],
  },
];

export function AddMenu({ open, closing, onClosed, onRequestClose, bottom, right }: {
  open: boolean;
  /** Set to play the close animation; onClosed fires when it ends. */
  closing: boolean;
  onClosed: () => void;
  onRequestClose: () => void;
  /** Where the + button is, measured from the screen's bottom-right corner. */
  bottom: number;
  right: number;
}) {
  const { c, scheme, reduceMotion } = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!open) return;
    if (closing) {
      p.set(withTiming(0, { duration: 160, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(onClosed);
      }));
    } else {
      p.set(reduceMotion ? withTiming(1, { duration: 160 }) : withSpring(1, { damping: 22, stiffness: 320, mass: 0.7 }));
    }
  }, [open, closing, reduceMotion, p, onClosed]);

  const scrim = useAnimatedStyle(() => ({ opacity: p.get() }));
  // Grows from the + button's corner; with Reduce Motion it only fades.
  const card = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.get() * 1.6),
    transform: reduceMotion ? [] : [{ translateX: (1 - p.get()) * 90 }, { translateY: (1 - p.get()) * 110 }, { scale: 0.4 + 0.6 * p.get() }],
  }));

  function choose(k: Start) {
    onRequestClose();
    // Wine list or store shelf: the Wine selection assistant (app/lists.tsx) to choose which. A receipt has its own flow
    // (app/receipts.tsx); the rest start Add wine.
    router.push(k === 'list' ? '/lists' : k === 'receipt' ? '/receipts?new=1' : `/add?start=${k}`);
  }

  return (
    <Modal transparent visible={open} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onRequestClose}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: c.scrim }, scrim]}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onRequestClose} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[
          { position: 'absolute', right, bottom, width: 300, borderRadius: radius.lg, backgroundColor: c.surfaceRaised, paddingVertical: space[2], overflow: 'hidden' },
          lift(scheme, 'pop'),
          card,
        ]}
      >
        {SECTIONS.map((section, si) => (
          <View key={section.title} style={si ? { marginTop: space[1], borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline, paddingTop: space[1] } : undefined}>
        <Text accessibilityRole="header" style={[type.footnote, { fontWeight: '600', color: c.ink2, paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[1] }]}>{section.title}</Text>
        {section.choices.map(({ key, title, detail, Icon }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${detail}`}
            onPress={() => choose(key)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] }, pressed && { backgroundColor: c.fillQuiet }]}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon color={c.onAccentSoft} size={20} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[type.headline, { color: c.ink }]}>{title}</Text>
              <Text style={[type.footnote, { color: c.ink2 }]}>{detail}</Text>
            </View>
          </Pressable>
        ))}
          </View>
        ))}
      </Animated.View>
    </Modal>
  );
}
