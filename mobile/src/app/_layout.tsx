import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../lib/auth';
import { LocationProvider } from '../lib/location';
import { SplashIntro } from '../components/SplashIntro';
import { ThemeProvider, useTheme } from '../components/theme';

// The native splash stays up until the opening animation has drawn its first frame.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <ThemeProvider>
        <AuthProvider>
          <LocationProvider>
            <Navigator />
          </LocationProvider>
        </AuthProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

function Navigator() {
  const { c, scheme } = useTheme();
  const [intro, setIntro] = useState(true);
  const introDone = useCallback(() => setIntro(false), []);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="wine/[id]" />
        <Stack.Screen name="add" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
      {intro ? <SplashIntro onDone={introDone} /> : null}
    </View>
  );
}
