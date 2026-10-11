import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

export const colors = {
  wine: '#7B1E3A',
  wineLight: '#F6E9ED',
  text: '#1D1B1C',
  muted: '#6B6468',
  border: '#E4DEE1',
  bg: '#FBF9FA',
  card: '#FFFFFF',
  good: '#2E7D4F',
  bad: '#B3261E',
};

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, disabled, variant = 'primary', busy }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary'; busy?: boolean;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary, (pressed || disabled) && { opacity: 0.6 }]}
    >
      {busy ? <ActivityIndicator color={primary ? '#fff' : colors.wine} /> : <Text style={[styles.buttonText, !primary && { color: colors.wine }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted }}>{children}</Text>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Text style={{ color: colors.bad }}>{error instanceof Error ? error.message : String(error)}</Text>;
}

export function RatingPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value == null ? 0 : value >= n ? 1 : value >= n - 0.5 ? 0.5 : 0;
        return (
          <Pressable
            key={n}
            accessibilityLabel={`${n} stars`}
            // Tap once for a full star, again for a half star.
            onPress={() => onChange(value === n ? n - 0.5 : n)}
          >
            <Text style={{ fontSize: 30, color: fill ? colors.wine : colors.border, opacity: fill === 0.5 ? 0.45 : 1 }}>★</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 6 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  h2: { fontSize: 16, fontWeight: '600', color: colors.text },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text, backgroundColor: '#fff' },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.wine },
  secondary: { backgroundColor: colors.wineLight },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
