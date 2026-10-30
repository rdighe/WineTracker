/**
 * A taste card (yours, or a friend's): the flavors leaned to as bars, those
 * leaned away from, styles, usual price, grapes and places, favorite bottles.
 * Set on the wash of the style drunk most.
 */
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { dollars, wineTitle } from '../lib/format';
import type { RecStyle, TasteCard } from '../lib/types';
import type { WineStyle } from './theme';
import { Label, Muted, radius, space, type, useTheme } from './ui';

const WASH: Record<RecStyle, WineStyle> = { red: 'red', white: 'white', rose: 'rose', sparkling: 'sparkling', orange: 'orange', sweet: 'fortified' };
const STYLE_LABEL: Record<RecStyle, string> = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', orange: 'Orange', sweet: 'Dessert & fortified' };

export function FlavorCardView({ card, heading }: { card: TasteCard; heading?: string }) {
  const { c } = useTheme();
  const wash = c.wash[WASH[card.styles[0] ?? 'red']];
  const price = card.priceLowCents && card.priceHighCents ? `${dollars(card.priceLowCents)}–${dollars(card.priceHighCents)}` : null;
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: wash, padding: space[5], gap: space[4] }}>
      <View style={{ gap: 2 }}>
        <Text style={[type.caption, { color: c.ink2, letterSpacing: 0.6 }]}>{(heading ?? 'TASTE CARD').toUpperCase()}</Text>
        <Text accessibilityRole="header" style={[type.wineDisplay, { color: c.ink }]}>{card.name}</Text>
        <Muted>{card.rated ? `From ${card.rated} ${card.rated === 1 ? 'wine' : 'wines'}` : 'Not enough yet: rate a few wines'}</Muted>
      </View>

      {card.likes.length ? (
        <View style={{ gap: space[2] }}>
          <Label>Leans to</Label>
          {card.likes.map((f) => (
            <View key={f.key} accessibilityLabel={`${f.label}, ${Math.round(f.strength * 100)} percent`} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <Text style={[type.subhead, { width: 120, color: c.ink }]}>{f.label}</Text>
              <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surface }}>
                <View style={{ width: `${Math.max(8, f.strength * 100)}%`, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {card.dislikes.length ? <Line label="Leans away from" value={card.dislikes.map((d) => d.label).join(', ')} /> : null}
      {card.styles.length ? <Line label="Drinks" value={card.styles.map((s) => STYLE_LABEL[s]).join(', ')} /> : null}
      {price ? <Line label="Usually spends" value={`${price} a bottle`} /> : null}
      {card.grapes.length ? <Line label="Grapes" value={card.grapes.join(', ')} /> : null}
      {card.places.length ? <Line label="Places" value={card.places.join(', ')} /> : null}
      {card.favorites.length ? (
        <View style={{ gap: space[1] }}>
          <Label>Favorite bottles</Label>
          {card.favorites.map((f) => (
            <Pressable key={f.wineId} accessibilityRole="link" onPress={() => router.push(`/wine/${f.wineId}`)}>
              <Text style={[type.subhead, { color: c.ink }]} numberOfLines={1}>{`${f.vintage && f.vintage !== 'NV' ? `${f.vintage} ` : ''}${wineTitle(f.name)}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Label>{label}</Label>
      <Text style={[type.subhead, { color: c.ink }]}>{value}</Text>
    </View>
  );
}
