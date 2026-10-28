/**
 * "Near you" for For you and Where to buy: turn it on (current location, or a
 * state typed in when location is refused), switch between near you and
 * anywhere, and see what it's based on.
 */
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { STATES, stateCode, useLocation } from '../lib/location';
import { PinIcon } from './icons';
import { Button, Muted, Segmented, radius, space, type, useTheme } from './ui';

export function NearBar({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const loc = useLocation();
  const { c, scheme } = useTheme();
  const [choosing, setChoosing] = useState(false);
  const [typed, setTyped] = useState('');

  async function useHere() {
    if (await loc.useDevice()) {
      setChoosing(false);
      onChange(true);
    }
  }
  function useTyped() {
    const s = stateCode(typed);
    if (!s) return;
    loc.chooseState(s);
    setChoosing(false);
    onChange(true);
  }

  if (!loc.here || choosing) {
    return (
      <View style={{ gap: space[2] }}>
        {!choosing ? (
          <Button
            title="Shops near me"
            variant="secondary"
            size="sm"
            busy={loc.locating}
            icon={(color) => <PinIcon color={color} size={15} />}
            accessibilityLabel="Show wines at shops near me, or that ship to me"
            onPress={() => setChoosing(true)}
          />
        ) : (
          <View style={{ gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: c.surfaceSunken }}>
            <Text style={[type.subhead, { color: c.ink }]}>Find wines at shops near you, and shops that ship to your state.</Text>
            <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
              <Button title="Use my location" size="sm" busy={loc.locating} icon={(color) => <PinIcon color={color} size={15} />} onPress={useHere} />
              <Button title="Not now" variant="plain" size="sm" onPress={() => setChoosing(false)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <TextInput
                accessibilityLabel="Or type your state"
                placeholder="Or type your state, e.g. CA"
                placeholderTextColor={c.ink3}
                keyboardAppearance={scheme}
                autoCapitalize="words"
                value={typed}
                onChangeText={setTyped}
                onSubmitEditing={useTyped}
                returnKeyType="done"
                style={[type.subhead, { flex: 1, height: 36, paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: c.surface, color: c.ink }]}
              />
              <Button title="Use" variant="secondary" size="sm" disabled={!stateCode(typed)} onPress={useTyped} />
            </View>
            {loc.problem ? <Muted>{loc.problem}</Muted> : null}
            <Muted>Your location stays on your phone except to find nearby shops; it isn’t saved.</Muted>
          </View>
        )}
      </View>
    );
  }

  const where = loc.here.label || STATES[loc.here.state] || 'you';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <PinIcon color={on ? c.accent : c.ink2} size={16} />
      <Segmented<'near' | 'any'>
        small
        options={[{ key: 'near', label: `Near ${where}` }, { key: 'any', label: 'Anywhere' }]}
        value={on ? 'near' : 'any'}
        onChange={(v) => onChange(v === 'near')}
      />
    </View>
  );
}

/** What a near-you answer came to, in words: nothing near (showing all), or still checking shops. */
export function nearNote(near: { applied: boolean; state: string; pending: number } | undefined, what: string): string | null {
  if (!near) return null;
  const ships = near.state ? ` or ship to ${STATES[near.state] ?? near.state}` : '';
  if (!near.applied) {
    return near.pending
      ? `Still finding which shops are near you${ships}. Showing all ${what} for now.`
      : `No shops near you${ships} have ${what === 'shops' ? 'this wine' : 'these'} yet. Showing all ${what}.`;
  }
  return near.pending ? 'Still checking a few more shops; more may appear.' : null;
}

/** "8 mi · K&L" / "In San Francisco" / "Ships to you" for a card or an offer. */
export function nearbyLabel(n: { local: boolean; miles: number | null; city: string; ships: boolean; shop?: string }): string {
  const shop = n.shop ? ` · ${n.shop}` : '';
  if (n.local) return n.miles !== null ? `${n.miles < 1 ? '<1' : Math.round(n.miles)} mi away${shop}` : `In ${n.city || 'your state'}${shop}`;
  return `Ships to you${shop}`;
}
