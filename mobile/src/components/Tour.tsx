/**
 * The tour: four short steps pointing at the real controls on Home - Find a
 * bottle, Out and about? (wine lists and shelves), the + button and the
 * Cellar tab. Everything dims but the control being explained; Skip is always
 * there. Shown once after sign-in (lib/tour.ts), and again from Settings ›
 * Show the tour.
 *
 * Controls anywhere in the app take part with useTourTarget('<key>'), which
 * gives them a ref the tour measures on screen.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Modal, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { lift } from './Glass';
import { Button, radius, space, type, useTheme } from './ui';

const targets = new Map<string, RefObject<View | null>>();

/** A ref for a control the tour can point at. */
export function useTourTarget(key: string) {
  const ref = useRef<View>(null);
  useEffect(() => {
    targets.set(key, ref);
    return () => {
      if (targets.get(key) === ref) targets.delete(key);
    };
  }, [key]);
  return ref;
}

export const TOUR_STEPS = [
  { target: 'prompt', title: 'Ask for a bottle', body: 'Tell us the occasion and what you’re eating. We’ll pick from your cellar first, then shops near you, and say why.' },
  { target: 'scan', title: 'At a restaurant or a store?', body: 'Photograph the wine list or the shelf. Every wine gets ranked for your taste, with fair prices flagged.' },
  { target: 'add', title: 'Add bottles in seconds', body: 'Scan a label or a lineup of up to 12 bottles, or search. Choose "In my cellar" to keep track of what you own.' },
  { target: 'cellar', title: 'Your cellar', body: 'Every bottle you own, what it cost and what it’s worth now. Your tastings live in Journal, next door.' },
] as const;

interface Rect { x: number; y: number; w: number; h: number }
const PAD = 6;

export function Tour({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const { c, scheme, reduceMotion } = useTheme();
  const { width, height } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const x = useSharedValue(0), y = useSharedValue(0), w = useSharedValue(0), h = useSharedValue(0);

  const measure = useCallback((i: number) => {
    const ref = targets.get(TOUR_STEPS[i]!.target);
    if (!ref?.current) {
      setRect(null);
      return;
    }
    ref.current.measureInWindow((mx, my, mw, mh) => {
      const r = { x: mx - PAD, y: my - PAD, w: mw + 2 * PAD, h: mh + 2 * PAD };
      setRect(r);
      const go = (v: typeof x, to: number) => { v.value = reduceMotion ? withTiming(to, { duration: 0 }) : withSpring(to, { damping: 22, stiffness: 220 }); };
      go(x, r.x); go(y, r.y); go(w, r.w); go(h, r.h);
    });
  }, [reduceMotion, x, y, w, h]);

  useEffect(() => {
    if (!visible) return;
    // Give the screen a moment to lay out before measuring; each showing starts at step 1.
    const t = setTimeout(() => {
      setStep(0);
      measure(0);
    }, 250);
    return () => clearTimeout(t);
  }, [visible, measure]);

  useEffect(() => {
    if (visible) AccessibilityInfo.announceForAccessibility(`Tour, step ${step + 1} of ${TOUR_STEPS.length}: ${TOUR_STEPS[step]!.title}`);
  }, [visible, step]);

  const next = () => {
    if (step + 1 >= TOUR_STEPS.length) return onDone();
    setStep(step + 1);
    measure(step + 1);
  };

  // The dimmed area is four panes around the target; the target stays bright and tappable-looking.
  const dim = c.scrim.replace(/[\d.]+\)$/, scheme === 'dark' ? '0.7)' : '0.55)');
  const top = useAnimatedStyle(() => ({ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(0, y.value) }));
  const bottom = useAnimatedStyle(() => ({ position: 'absolute', left: 0, right: 0, top: y.value + h.value, bottom: 0 }));
  const left = useAnimatedStyle(() => ({ position: 'absolute', left: 0, width: Math.max(0, x.value), top: y.value, height: h.value }));
  const right = useAnimatedStyle(() => ({ position: 'absolute', left: x.value + w.value, right: 0, top: y.value, height: h.value }));
  const ring = useAnimatedStyle(() => ({ position: 'absolute', left: x.value, top: y.value, width: w.value, height: h.value }));

  const s = TOUR_STEPS[step]!;
  const below = !rect || rect.y + rect.h < height * 0.55;
  const bubble = rect ? (below ? { top: rect.y + rect.h + space[3] } : { bottom: height - rect.y + space[3] }) : { top: height * 0.35 };

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <View style={{ flex: 1 }} accessibilityViewIsModal>
        {rect ? (
          <>
            {[top, bottom, left, right].map((st, i) => <Animated.View key={i} style={[st, { backgroundColor: dim }]} />)}
            <Animated.View pointerEvents="none" style={[ring, { borderRadius: radius.md, borderWidth: 2, borderColor: c.surface }]} />
          </>
        ) : (
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: dim }} />
        )}
        <Animated.View
          key={step}
          entering={reduceMotion ? undefined : FadeIn.duration(200)}
          style={[{ position: 'absolute', left: space[4], right: space[4], maxWidth: Math.min(width - 2 * space[4], 440), padding: space[4], gap: space[2], borderRadius: radius.md, backgroundColor: c.surfaceRaised }, bubble, lift(scheme, 'pop')]}
        >
          <Text style={[type.caption, { color: c.accent, letterSpacing: 0.6 }]}>{`${step + 1} OF ${TOUR_STEPS.length}`}</Text>
          <Text accessibilityRole="header" style={[type.title3, { color: c.ink }]}>{s.title}</Text>
          <Text style={[type.subhead, { color: c.ink2 }]}>{s.body}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] }}>
            <Button title="Skip tour" variant="plain" size="sm" onPress={onDone} />
            <Button title={step + 1 >= TOUR_STEPS.length ? 'Done' : 'Next'} size="sm" onPress={next} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
