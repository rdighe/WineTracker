import { Stack } from 'expo-router';
import { ShareIntentModule, ShareIntentProvider } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../lib/auth';
import { LocationProvider } from '../lib/location';
import { SplashIntro } from '../components/SplashIntro';
import { ThemeProvider, useTheme } from '../components/theme';

// The native splash stays up until the opening animation has drawn its first frame.
SplashScreen.preventAutoHideAsync();

// Photos and PDFs shared from other apps (src/app/shared.tsx); kept until read, through sign-in.
// Off where the native module isn't built in (web, Expo Go).
const SHARE_OPTIONS = { resetOnBackground: false, disabled: Platform.OS === 'web' || !ShareIntentModule };

export default function RootLayout() {
  return (
    <ShareIntentProvider options={SHARE_OPTIONS}>
      <KeyboardProvider>
        <ThemeProvider>
          <AuthProvider>
            <LocationProvider>
              <Navigator />
            </LocationProvider>
          </AuthProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </ShareIntentProvider>
  );
}

function Navigator() {
  const { c, scheme } = useTheme();
  const [intro, setIntro] = useState(true);
  const introDone = useCallback(() => setIntro(false), []);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={intro || scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="wine/[id]" />
        <Stack.Screen name="add" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="picks" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="shared" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="find" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="lists" />
        <Stack.Screen name="cellars" />
        <Stack.Screen name="join" />
        <Stack.Screen name="racks" />
        <Stack.Screen name="receipts" />
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      {intro ? <SplashIntro onDone={introDone} /> : null}
    </View>
  );
}
