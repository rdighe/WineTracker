import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

// Where Google sign-in returns to (src/lib/auth.tsx). On web this page opens in
// the sign-in popup and hands the result back to the app; on iPhone the system
// browser catches the address first, so this only shows if a link is opened directly.
export default function AuthReturn() {
  WebBrowser.maybeCompleteAuthSession();
  return <Redirect href="/" />;
}
