/** Settings › Location: off, the phone's location, or a state picked by hand (for shops near you and shipping). */
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { STATES, stateCode, useLocation, type LocationMode } from '../lib/location';
import { Button, Card, Heading, Muted, Segmented, radius, space, type, useTheme } from './ui';

export function LocationSettings() {
  const loc = useLocation();
  const { c, scheme } = useTheme();
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState(loc.mode === 'state' ? loc.here?.state ?? '' : '');
  const shown: LocationMode = picking ? 'state' : loc.mode;

  return (
    <Card style={{ gap: space[3] }}>
      <Heading>Location</Heading>
      <Muted style={type.subhead}>Find wines at shops near you and shops that ship to your state, on For you and each wine&apos;s Where to buy.</Muted>
      <Segmented<LocationMode>
        options={[{ key: 'off', label: 'Off' }, { key: 'device', label: 'My location' }, { key: 'state', label: 'A state' }]}
        value={shown}
        onChange={(m) => {
          if (m === 'off') {
            setPicking(false);
            loc.turnOff();
          } else if (m === 'device') {
            setPicking(false);
            void loc.useDevice();
          } else {
            setPicking(true);
          }
        }}
      />
      {shown === 'state' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <TextInput
            accessibilityLabel="Your state"
            placeholder="State, e.g. CA or California"
            placeholderTextColor={c.ink3}
            keyboardAppearance={scheme}
            autoCapitalize="words"
            value={typed}
            onChangeText={setTyped}
            style={[type.body, { flex: 1, height: 44, paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: c.surfaceSunken, color: c.ink }]}
          />
          <Button title="Use" variant="secondary" size="md" disabled={!stateCode(typed)} onPress={() => { loc.chooseState(typed); setPicking(false); }} />
        </View>
      ) : null}
      {loc.problem ? <Muted>{loc.problem}</Muted> : null}
      <Muted>
        {loc.here
          ? `Using ${loc.mode === 'state' ? STATES[loc.here.state] : loc.here.label}. It's only sent to find shops, never saved.`
          : 'Off: you see every shop, wherever it is.'}
      </Muted>
    </Card>
  );
}
