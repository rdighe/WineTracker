/** A date (YYYY-MM-DD): the native compact date picker on iOS/Android, a text field on the web. */
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, TextInput, View } from 'react-native';
import { todayIso } from '../lib/format';
import { Eyebrow, colors, fonts, styles } from './ui';

const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function DateField({ label, value, onChange }: { label?: string; value: string; onChange: (iso: string) => void }) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      {Platform.OS === 'web' ? (
        <TextInput
          accessibilityLabel={label ?? 'Date'}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.faint}
          maxLength={10}
          style={[styles.input, { width: 140, fontFamily: fonts.mono, textAlign: 'center' }]}
        />
      ) : (
        <DateTimePicker
          accessibilityLabel={label ?? 'Date'}
          value={toDate(valid)}
          mode="date"
          display="compact"
          maximumDate={new Date()}
          themeVariant="dark"
          accentColor={colors.accent}
          onChange={(_e, d) => d && onChange(toIso(d))}
        />
      )}
    </View>
  );
}
