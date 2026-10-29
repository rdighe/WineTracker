import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class LabelTextModule extends NativeModule<{}> {
  /** Lines of text in the image file at `uri`, top to bottom. */
  recognizeTextAsync(uri: string): Promise<string[]>;
  /** Every piece of text with its box (0-1, origin top-left), in no particular order. */
  recognizeTextLayoutAsync(uri: string): Promise<TextBox[]>;
  /** A PDF's first `maxPages` pages as JPEG files, the longer side `maxSide` pixels; and how many pages it has. */
  renderPdfPagesAsync(uri: string, maxPages: number, maxSide: number): Promise<{ pages: PdfPage[]; pageCount: number }>;
}

export interface PdfPage { uri: string; width: number; height: number }

export interface TextBox { text: string; x: number; y: number; w: number; h: number }

// Optional: absent in Expo Go and on Android, where scans go straight to the server's LLM read.
export default requireOptionalNativeModule<LabelTextModule>('LabelText');
