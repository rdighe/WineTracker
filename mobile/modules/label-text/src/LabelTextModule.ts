import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class LabelTextModule extends NativeModule<{}> {
  /** Lines of text in the image file at `uri`, top to bottom. */
  recognizeTextAsync(uri: string): Promise<string[]>;
  /** Every piece of text with its box (0-1, origin top-left), in no particular order. */
  recognizeTextLayoutAsync(uri: string): Promise<TextBox[]>;
}

export interface TextBox { text: string; x: number; y: number; w: number; h: number }

// Optional: absent in Expo Go and on Android, where scans go straight to the server's LLM read.
export default requireOptionalNativeModule<LabelTextModule>('LabelText');
