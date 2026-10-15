import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class LabelTextModule extends NativeModule<{}> {
  /** Lines of text in the image file at `uri`, top to bottom. */
  recognizeTextAsync(uri: string): Promise<string[]>;
}

// Optional: absent in Expo Go and on Android, where scans go straight to the server's LLM read.
export default requireOptionalNativeModule<LabelTextModule>('LabelText');
