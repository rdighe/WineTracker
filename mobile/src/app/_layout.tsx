import { Newsreader_400Regular, Newsreader_500Medium, Newsreader_600SemiBold, useFonts } from '@expo-google-fonts/newsreader';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../lib/auth';
import { ThemeProvider, useTheme } from '../components/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // The serif for wine names: iOS has Apple's New York built in; elsewhere Newsreader.
  const [loaded, error] = useFonts(Platform.OS === 'ios' ? {} : { Newsreader_400Regular, Newsreader_500Medium, Newsreader_600SemiBold });
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <AuthProvider>
          <Navigator />
        </AuthProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

function Navigator() {
  const { c, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="wine/[id]" />
      </Stack>
    </>
  );
}
