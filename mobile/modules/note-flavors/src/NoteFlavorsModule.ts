import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class NoteFlavorsModule extends NativeModule<{}> {
  /** Whether Apple Intelligence's on-device model can be used right now (iOS 26+, a supported iPhone, turned on). */
  isAvailableAsync(): Promise<boolean>;
  /** Flavor family -> intensity 1-3 that the note says the wine has. */
  readAsync(text: string): Promise<Record<string, number>>;
}

// Optional: absent in Expo Go and on Android, where the server reads notes instead.
export default requireOptionalNativeModule<NoteFlavorsModule>('NoteFlavors');
